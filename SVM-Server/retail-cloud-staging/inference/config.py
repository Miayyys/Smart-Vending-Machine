"""
推理服务配置 — 类别名、置信度阈值、模型路径
"""
import os

# ═══════════════════════════════════════════════════════
# 主模型 (4类, best.onnx, dataset3_yolo)
# 标签顺序: 0=nongfu 1=runtian 2=soda 3=yogurt
# ═══════════════════════════════════════════════════════
PRIMARY_CLASS_NAMES = {
    0: "nongfu",   # 农夫山泉
    1: "runtian",  # 润田
    2: "soda",     # 可乐/雪碧
    3: "yogurt",   # 酸奶
}
PRIMARY_CLASS_CONF = {
    0: 0.25,  # nongfu
    1: 0.25,  # runtian
    2: 0.25,  # soda
    3: 0.60,  # yogurt — 误检多, 提高阈值
}

# ═══════════════════════════════════════════════════════
# 交叉验证模型 (3类, best_3class.onnx)
# 标签顺序: 0=nongfu 1=runtian 2=soda（无yogurt）
# ═══════════════════════════════════════════════════════
CROSS_CLASS_NAMES = {
    0: "nongfu",   # 农夫山泉
    1: "runtian",  # 润田
    2: "soda",     # 可乐/雪碧
}
CROSS_CLASS_CONF = {
    0: 0.25,  # nongfu
    1: 0.25,  # runtian
    2: 0.25,  # soda
}

# 兼容旧代码的别名
CLASS_NAMES = PRIMARY_CLASS_NAMES
CLASS_CONF = PRIMARY_CLASS_CONF

# 推理图像尺寸（两模型一致）
IMGSZ = 320

# 服务端口
PORT = int(os.environ.get("INFERENCE_PORT", "8000"))
