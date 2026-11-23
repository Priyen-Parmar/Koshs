FROM python:3.13-slim
RUN apt-get update && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-eng && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py ./
COPY backend ./backend
COPY fixtures ./fixtures
COPY ui ./ui
COPY samples ./samples
ENV KOSH_HOST=0.0.0.0 PORT=8765 KOSH_DB=/data/kosh.sqlite TESSDATA_PREFIX=/usr/share/tesseract-ocr/5/tessdata
EXPOSE 8765
CMD ["python","app.py"]

