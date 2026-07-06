"""
零售柜饮料识别推理服务 (ONNX Runtime 版本)
- 使用 ONNX Runtime 替代 PyTorch，内存占用 ~200MB vs 800MB+
- 提供 POST /detect 接口，对传入图片做推理，返回各类饮料数量
"""
import time
import logging
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image

from config import CLASS_NAMES, CLASS_CONF, IMGSZ, PORT

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("inference")

# ── 加载 ONNX 模型 ────────────────────────────
MODEL_PATH = "/app/model/best.onnx"
log.info(f"Loading ONNX model from {MODEL_PATH} ...")
session = ort.InferenceSession(MODEL_PATH, providers=["CPUExecutionProvider"])
input_name = session.get_inputs()[0].name
out_names = [o.name for o in session.get_outputs()]
log.info(f"ONNX model loaded. Input: {input_name}, Outputs: {out_names}")

# 预热
dummy = np.random.randn(1, 3, IMGSZ, IMGSZ).astype(np.float32)
session.run(out_names, {input_name: dummy})
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

# ── YOLO 后处理 ─────────────────────────────────
def postprocess(output: np.ndarray, orig_w: int, orig_h: int):
    """
    YOLO11n 输出: (1, 8, 2100) — [cx, cy, w, h, obj_conf, c0, c1, c2, c3]
    坐标在 320×320 空间（非归一化）。
    返回: [(class_name, confidence, x1, y1, x2, y2), ...]
    """
    preds = np.squeeze(output, axis=0).T  # (2100, 8)
    boxes_xywh = preds[:, :4]              # cx, cy, w, h (320空间)
    class_scores = preds[:, 4:]            # (2100, nc) — YOLOv8/11 无独立 objectness

    # 置信度过滤
    max_cls_score = class_scores.max(axis=1)
    mask = max_cls_score > 0.25
    if not mask.any():
        return []

    boxes = boxes_xywh[mask]
    scores = max_cls_score[mask]
    cls_ids = class_scores[mask].argmax(axis=1)

    # xywh → xyxy (320空间)
    cx, cy, w, h = boxes[:, 0], boxes[:, 1], boxes[:, 2], boxes[:, 3]
    x1_320 = cx - w / 2
    y1_320 = cy - h / 2
    x2_320 = cx + w / 2
    y2_320 = cy + h / 2

    # NMS (在 320 空间做)
    keep = _nms(np.stack([x1_320, y1_320, x2_320, y2_320], axis=1), scores, 0.45)

    # 缩放到原始图像尺寸
    scale_x = orig_w / IMGSZ
    scale_y = orig_h / IMGSZ

    results = []
    for i in keep:
        cls_id = int(cls_ids[i])
        conf = float(scores[i])
        threshold = CLASS_CONF.get(cls_id, 0.25)
        if conf < threshold:
            continue
        cls_name = CLASS_NAMES.get(cls_id, f"cls_{cls_id}")
        results.append((cls_name, conf,
                        float(x1_320[i] * scale_x), float(y1_320[i] * scale_y),
                        float(x2_320[i] * scale_x), float(y2_320[i] * scale_y)))
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
        area_i = (boxes[i, 2] - boxes[i, 0]) * (boxes[i, 3] - boxes[i, 1])
        area_o = (boxes[order[1:], 2] - boxes[order[1:], 0]) * (boxes[order[1:], 3] - boxes[order[1:], 1])
        iou = inter / (area_i + area_o - inter + 1e-6)
        order = order[1:][iou <= iou_thres]
    return keep

# ── FastAPI ────────────────────────────────────
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI(title="Retail Drink Detector (ONNX)", version="2.0.0")

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

@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/detect", response_model=DetectResponse)
def detect(req: DetectRequest):
    t0 = time.time()
    img_path = Path(req.image_path)
    if not img_path.exists():
        raise HTTPException(status_code=404, detail=f"Image not found: {req.image_path}")

    try:
        img = Image.open(img_path)
        orig_w, orig_h = img.size
        tensor = preprocess(str(img_path))
        outputs = session.run(out_names, {input_name: tensor})
        detections = postprocess(outputs[0], orig_w, orig_h)

        counts = {name: 0 for name in CLASS_NAMES.values()}
        details = []
        for cls_name, conf, x1, y1, x2, y2 in detections:
            counts[cls_name] += 1
            details.append(DetectionItem(class_name=cls_name, confidence=round(conf, 4),
                                         x1=round(x1, 1), y1=round(y1, 1),
                                         x2=round(x2, 1), y2=round(y2, 1)))

        elapsed = (time.time() - t0) * 1000
        total = sum(counts.values())
        log.info(f"detect {img_path.name}: total={total} " + " ".join(f"{k}={v}" for k, v in counts.items()) + f" ({elapsed:.0f}ms)")

        return DetectResponse(success=True, image_path=req.image_path,
                              counts=counts, total=total, details=details, processed_ms=round(elapsed, 1))
    except Exception as e:
        log.error(f"detect failed: {img_path.name} — {e}")
        return DetectResponse(success=False, image_path=req.image_path,
                              counts={}, total=0, details=[], processed_ms=(time.time()-t0)*1000, error=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)
