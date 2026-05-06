# Single container: FastAPI serves frontend + API
FROM mcr.microsoft.com/playwright/python:v1.53.0-jammy

WORKDIR /app

COPY api/requirements.txt /app/api/requirements.txt
RUN pip install --no-cache-dir -r /app/api/requirements.txt

COPY api/main.py /app/api/main.py
COPY index.html /app/index.html

ENV PYTHONUNBUFFERED=1
EXPOSE 80

CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "80"]
