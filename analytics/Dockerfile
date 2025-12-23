FROM python:3.9-slim

WORKDIR /app

# Dependencias de sistema
RUN apt-get update && apt-get install -y libpq-dev gcc

# Dependencias de Python
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copiar código
COPY . .

# El worker se ejecuta directamente con python
CMD ["python", "worker.py"]
