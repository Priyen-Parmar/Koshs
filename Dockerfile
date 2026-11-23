FROM python:3.13-slim
RUN apt-get update && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-eng && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py engine.py reader.py vision.py policy.py service.py comms.py lab.py make_samples.py windows_ocr.ps1 ./
COPY orders.csv vendors.csv ledger_seed.csv sample_catalog.json mailbox.json ./
COPY ui ./ui
COPY samples ./samples
ENV KOSH_HOST=0.0.0.0 PORT=8765 KOSH_DB=/data/kosh.sqlite TESSDATA_PREFIX=/usr/share/tesseract-ocr/5/tessdata
EXPOSE 8765
CMD ["python","app.py"]

