"""
推理服务配置 — 类别名、置信度阈值、模型路径
与 train3 训练标签顺序一致: 0=nongfu 1=runtian 2=soda 3=yogurt
"""
import os

# 类别名(按 train3 标签顺序)
CLASS_NAMES = {
    0: "nongfu",   # 农夫山泉
    1: "runtian",  # 润田
    2: "soda",     # 可乐/雪碧
    3: "yogurt",   # 酸奶
}

# 每类独立置信度阈值 — yogurt 误检多, 提高阈值过滤
CLASS_CONF = {
    0: 0.25,  # nongfu
    1: 0.25,  # runtian
    2: 0.25,  # soda
    3: 0.60,  # yogurt
}

# 模型路径 (Docker 内挂载)
MODEL_PATH = os.environ.get("MODEL_PATH", "/app/model/best.pt")

# 推理图像尺寸
IMGSZ = 320

# 服务端口
PORT = int(os.environ.get("INFERENCE_PORT", "8000"))
