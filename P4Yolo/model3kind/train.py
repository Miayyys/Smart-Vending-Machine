from ultralytics import YOLO
import os

# 数据集路径 — 部署时修改为实际路径
DATA_DIR = os.path.dirname(os.path.abspath(__file__))

model = YOLO('yolo11n.pt')
results = model.train(
    data=os.path.join(DATA_DIR, 'data.yaml'),
    epochs=100,
    imgsz=640,
    batch=16,
    workers=2,
    cache=True,
    device=0,
    name='model3kind_yolo11n',
    project=DATA_DIR,
    exist_ok=True,
    patience=20,
    seed=42,
)
print('TRAINING_COMPLETE')
print(f'save_dir={results.save_dir}')
