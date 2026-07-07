"""
零售柜饮料识别推理服务 (ONNX Runtime 版本)
- 支持主模型(4类) / 交叉模型(3类) 切换
- 支持启用/禁用推理开关
- 提供 POST /detect、GET /model/active、POST /model/switch、POST /model/toggle
"""
import time
import logging
import threading
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image

from config import (
    PRIMARY_CLASS_NAMES, PRIMARY_CLASS_CONF,
    CROSS_CLASS_NAMES, CROSS_CLASS_CONF,
    IMGSZ, PORT,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("inference")

# ── 全局状态 ─────────────────────────────────
_active_model = "primary"   # "primary" | "cross"
_enabled = True
_state_lock = threading.Lock()

# ── 加载 ONNX 模型 ────────────────────────────
PRIMARY_PATH = "/app/model/best.onnx"
CROSS_PATH = "/app/model/best_3class.onnx"

log.info(f"Loading primary model (4-class) from {PRIMARY_PATH} ...")
primary_session = ort.InferenceSession(PRIMARY_PATH, providers=["CPUExecutionProvider"])
primary_inp = primary_session.get_inputs()[0].name
primary_out = [o.name for o in primary_session.get_outputs()]
log.info(f"Primary loaded. Input: {primary_inp}, Outputs: {primary_out}")

log.info(f"Loading cross model (3-class) from {CROSS_PATH} ...")
cross_session = ort.InferenceSession(CROSS_PATH, providers=["CPUExecutionProvider"])
cross_inp = cross_session.get_inputs()[0].name
cross_out = [o.name for o in cross_session.get_outputs()]
log.info(f"Cross loaded. Input: {cross_inp}, Outputs: {cross_out}")

# 预热
dummy = np.random.randn(1, 3, IMGSZ, IMGSZ).astype(np.float32)
primary_session.run(primary_out, {primary_inp: dummy})
cross_session.run(cross_out, {cross_inp: dummy})
log.info("Warmup done, server ready")

# ── 图像预处理 ─────────────────────────────────
def preprocess(image_path: str) -> np.ndarray:
    """读取图片 → 缩放到 IMGSZ×IMGSZ → 归一化 → (1,3,H,W)"""
    img = Image.open(image_path).convert("RGB")
    img = img.resize((IMGSZ, IMGSZ), Image.BILINEAR)
    arr = np.array(img, dtype=np.float32) / 255.0          # [0,1]
    arr = arr.transpose(2, 0, 1)                            # CHW
    arr = np.expand_dims(arr, axis=0)                       # NCHW
    return arr

# ── YOLO 后处理 (通用, 按传入的 cls_names/cls_conf 适配 3/4 类) ──
def postprocess(output: np.ndarray, orig_w: int, orig_h: int,
                cls_names: dict, cls_conf: dict):
    """
    YOLO11n 输出: (1, 4+nc, 2100) — [cx,cy,w,h, c0..cn]
    坐标在 320×320 空间（非归一化）。
    """
    preds = np.squeeze(output, axis=0).T     # (2100, 4+nc)
    boxes_xywh = preds[:, :4]
    class_scores = preds[:, 4:]

    max_cls_score = class_scores.max(axis=1)
    mask = max_cls_score > 0.25
    if not mask.any():
        return []

    boxes = boxes_xywh[mask]
    scores = max_cls_score[mask]
    cls_ids = class_scores[mask].argmax(axis=1)

    # xywh → xyxy (320空间)
    cx, cy, w, h = boxes[:, 0], boxes[:, 1], boxes[:, 2], boxes[:, 3]
    x1_320 = cx - w/2; y1_320 = cy - h/2
    x2_320 = cx + w/2; y2_320 = cy + h/2

    keep = _nms(np.stack([x1_320, y1_320, x2_320, y2_320], axis=1), scores, 0.45)

    scale_x = orig_w / IMGSZ
    scale_y = orig_h / IMGSZ

    results = []
    for i in keep:
        cls_id = int(cls_ids[i])
        conf = float(scores[i])
        threshold = cls_conf.get(cls_id, 0.25)
        if conf < threshold:
            continue
        cls_name = cls_names.get(cls_id, f"cls_{cls_id}")
        results.append((cls_name, conf,
                        float(x1_320[i]*scale_x), float(y1_320[i]*scale_y),
                        float(x2_320[i]*scale_x), float(y2_320[i]*scale_y)))
    return results

def _nms(boxes: np.ndarray, scores: np.ndarray, iou_thres: float) -> list:
    """简易 NMS，返回保留的索引列表"""
    order = scores.argsort()[::-1]
    keep = []
    while order.size > 0:
        i = order[0]
        keep.append(i)
        if order.size == 1:
            break
        xx1 = np.maximum(boxes[i, 0], boxes[order[1:], 0])
        yy1 = np.maximum(boxes[i, 1], boxes[order[1:], 1])
        xx2 = np.minimum(boxes[i, 2], boxes[order[1:], 2])
        yy2 = np.minimum(boxes[i, 3], boxes[order[1:], 3])
        w = np.maximum(0.0, xx2 - xx1)
        h = np.maximum(0.0, yy2 - yy1)
        inter = w * h
        area_i = (boxes[i,2]-boxes[i,0]) * (boxes[i,3]-boxes[i,1])
        area_o = (boxes[order[1:],2]-boxes[order[1:],0]) * (boxes[order[1:],3]-boxes[order[1:],1])
        iou = inter / (area_i + area_o - inter + 1e-6)
        order = order[1:][iou <= iou_thres]
    return keep

# ── FastAPI ────────────────────────────────────
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="Retail Drink Detector (ONNX)", version="2.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

class DetectRequest(BaseModel):
    image_path: str

class DetectionItem(BaseModel):
    class_name: str
    confidence: float
    x1: float; y1: float; x2: float; y2: float

class DetectResponse(BaseModel):
    success: bool
    image_path: str
    counts: dict[str, int]
    total: int
    details: list[DetectionItem]
    processed_ms: float
    error: str | None = None

class ActiveResponse(BaseModel):
    model: str
    enabled: bool
    model_label: str

@app.get("/health")
def health():
    return {"status": "ok"}

# ── 模型管理端点 ──────────────────────────────

@app.get("/model/active", response_model=ActiveResponse)
def get_active():
    with _state_lock:
        model = _active_model
        enabled = _enabled
    return ActiveResponse(
        model=model,
        enabled=enabled,
        model_label=("4类(主模型)" if model == "primary" else "3类(交叉验证用)"),
    )

@app.post("/model/switch")
def switch_model():
    global _active_model
    with _state_lock:
        _active_model = "cross" if _active_model == "primary" else "primary"
        new = _active_model
    log.info(f"Model switched to: {new}")
    return {
        "model": new,
        "label": "4类(主模型)" if new == "primary" else "3类(交叉验证用)",
    }

@app.post("/model/toggle")
def toggle_enabled():
    global _enabled
    with _state_lock:
        _enabled = not _enabled
        new = _enabled
    log.info(f"Inference {'enabled' if new else 'disabled'}")
    return {"enabled": new}

# ── 推理端点 ──────────────────────────────────

@app.post("/detect", response_model=DetectResponse)
def detect(req: DetectRequest):
    t0 = time.time()

    with _state_lock:
        enabled = _enabled
        active = _active_model

    if not enabled:
        return DetectResponse(
            success=False, image_path=req.image_path,
            counts={}, total=0, details=[],
            processed_ms=(time.time()-t0)*1000,
            error="inference disabled")

    # 选择模型和类别映射
    if active == "primary":
        session, inp_name, out_names = primary_session, primary_inp, primary_out
        cls_names, cls_conf = PRIMARY_CLASS_NAMES, PRIMARY_CLASS_CONF
    else:
        session, inp_name, out_names = cross_session, cross_inp, cross_out
        cls_names, cls_conf = CROSS_CLASS_NAMES, CROSS_CLASS_CONF

    img_path = Path(req.image_path)
    if not img_path.exists():
        raise HTTPException(status_code=404, detail=f"Image not found: {req.image_path}")

    try:
        img = Image.open(img_path)
        orig_w, orig_h = img.size
        tensor = preprocess(str(img_path))
        outputs = session.run(out_names, {inp_name: tensor})
        detections = postprocess(outputs[0], orig_w, orig_h, cls_names, cls_conf)

        counts = {name: 0 for name in cls_names.values()}
        details = []
        for cls_name, conf, x1, y1, x2, y2 in detections:
            counts[cls_name] += 1
            details.append(DetectionItem(
                class_name=cls_name, confidence=round(conf, 4),
                x1=round(x1,1), y1=round(y1,1),
                x2=round(x2,1), y2=round(y2,1)))

        elapsed = (time.time() - t0) * 1000
        total = sum(counts.values())
        label = "4C" if active == "primary" else "3C"
        log.info(f"[{label}] {img_path.name}: total={total} " +
                 " ".join(f"{k}={v}" for k,v in counts.items()) + f" ({elapsed:.0f}ms)")

        return DetectResponse(
            success=True, image_path=req.image_path,
            counts=counts, total=total, details=details,
            processed_ms=round(elapsed, 1))

    except Exception as e:
        log.error(f"detect failed: {img_path.name} — {e}")
        return DetectResponse(
            success=False, image_path=req.image_path,
            counts={}, total=0, details=[],
            processed_ms=(time.time()-t0)*1000, error=str(e))


# ── 背景图管理（用于异物检测基线）──────────────
from fastapi import UploadFile, File, Form
from fastapi.responses import FileResponse
import shutil

BG_DIR = Path("/app/snapshots")
BG_DIR.mkdir(parents=True, exist_ok=True)

def _bg_path(device_id: str) -> Path:
    # 防路径穿越
    safe = "".join(c for c in device_id if c.isalnum() or c in "-_")
    return BG_DIR / f"background_{safe}.jpg"

@app.post("/background/upload")
async def upload_background(
    file: UploadFile = File(...),
    deviceId: str = Form(...),
):
    p = _bg_path(deviceId)
    with p.open("wb") as f:
        shutil.copyfileobj(file.file, f)
    log.info(f"background saved: {p.name} ({p.stat().st_size} bytes)")
    return {"success": True, "deviceId": deviceId, "path": str(p)}

@app.get("/background/{deviceId}")
def get_background(deviceId: str):
    p = _bg_path(deviceId)
    if not p.exists():
        raise HTTPException(status_code=404, detail="background not found")
    return FileResponse(str(p), media_type="image/jpeg")


# ── 异物检测：区域像素比对 ────────────────────
class CompareBox(BaseModel):
    x1: float; y1: float; x2: float; y2: float

class CompareRequest(BaseModel):
    """指定对比对象：开门图路径 + 背景图路径 + 关门检测框列表"""
    close_image: str
    open_image: str
    background_image: str | None = None   # 可选，无则跳过拿取区域比对
    boxes: list[CompareBox] = []        # CLOSE 的检测框（用于区分拿取区/非拿取区）

class RegionDiff(BaseModel):
    region: str          # "take"=拿取区 / "untake"=非拿取区
    diff_ratio: float    # 差异面积占比 0-1
    mean_diff: float     # 平均像素差 0-255
    alerted: bool

class CompareResponse(BaseModel):
    success: bool
    alerts: list[RegionDiff]
    has_foreign: bool    # 是否判定有异物
    error: str | None = None

def _load_gray(path: str) -> np.ndarray | None:
    try:
        p = Path(path)
        if not p.exists(): return None
        img = Image.open(p).convert("L").resize((320, 320))
        return np.array(img, dtype=np.float32)
    except Exception as e:
        log.warning(f"load_gray failed {path}: {e}")
        return None

def _rescale_box(b, orig_w, orig_h):
    """把原始坐标缩放到 320x320 空间"""
    sx, sy = 320.0 / orig_w, 320.0 / orig_h
    return int(b.x1 * sx), int(b.y1 * sy), int(b.x2 * sx), int(b.y2 * sy)

def _region_diff(close_gray, ref_gray, mask_take: np.ndarray, region: str):
    """对指定区域(拿取/非拿取)做像素 diff"""
    mask = mask_take if region == "take" else (~mask_take & True)
    n_pix = int(mask.sum())
    if n_pix < 500:  # 区域太小，跳过防噪声
        return None
    diff = np.abs(close_gray - ref_gray)
    region_diff = diff[mask]
    mean_diff = float(region_diff.mean())
    # 差异面积占比：像素差>30 的占比
    diff_mask = region_diff > 30
    ratio = float(diff_mask.sum()) / n_pix
    # 触发条件：平均差>25 且 面积占比>15%
    alerted = mean_diff > 25 and ratio > 0.15
    return RegionDiff(region=region, diff_ratio=round(ratio, 4),
                      mean_diff=round(mean_diff, 2), alerted=alerted)

@app.post("/compare", response_model=CompareResponse)
def compare(req: CompareRequest):
    t0 = time.time()
    close_g = _load_gray(req.close_image)
    open_g = _load_gray(req.open_image)
    if close_g is None or open_g is None:
        return CompareResponse(success=False, alerts=[], has_foreign=False,
                                error="image not found")
    # 构建 320x320 的拿取区域 mask
    mask_take = np.zeros((320, 320), dtype=bool)
    try:
        # 取关闭图原始尺寸用于缩放框
        with Image.open(req.close_image) as im:
            ow, oh = im.size
    except Exception:
        ow, oh = 320, 320
    for b in req.boxes:
        x1, y1, x2, y2 = _rescale_box(b, ow, oh)
        x1 = max(0, min(319, x1)); y1 = max(0, min(319, y1))
        x2 = max(0, min(320, x2)); y2 = max(0, min(320, y2))
        if x2 > x1 and y2 > y1:
            mask_take[y1:y2, x1:x2] = True

    alerts = []
    # 1. 非拿取区域：关门 vs 开门（一致应无差异，有则异物）
    r_untake = _region_diff(close_g, open_g, mask_take, "untake")
    if r_untake: alerts.append(r_untake)
    # 2. 拿取区域：关门 vs 背景（拿走后应回到背景空柜状态，有则残留异物）
    has_foreign = False
    if r_untake and r_untake.alerted:
        has_foreign = True
    if req.background_image:
        bg_g = _load_gray(req.background_image)
        if bg_g is not None:
            r_take = _region_diff(close_g, bg_g, mask_take, "take")
            if r_take:
                alerts.append(r_take)
                if r_take.alerted:
                    has_foreign = True

    elapsed = (time.time() - t0) * 1000
    log.info(f"compare: alerts={len(alerts)} has_foreign={has_foreign} ({elapsed:.0f}ms)")
    return CompareResponse(success=True, alerts=alerts,
                            has_foreign=has_foreign)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)
