# ONNX Runtime 推理服务 — 轻量，镜像 ~400MB
FROM python:3.11-slim-bookworm

# 阿里云 APT 镜像源
RUN sed -i "s|deb.debian.org|mirrors.aliyun.com|g" /etc/apt/sources.list.d/debian.sources

WORKDIR /app

RUN apt-get update -qq \
    && apt-get install -y -qq --no-install-recommends \
        libgl1-mesa-glx libglib2.0-0 libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -i https://mirrors.aliyun.com/pypi/simple/ -r requirements.txt

COPY config.py .
COPY server_onnx.py server.py

RUN mkdir -p /app/model

EXPOSE 8000
ENV OMP_NUM_THREADS=2
ENV INFERENCE_PORT=8000

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

CMD ["python", "server.py"]
