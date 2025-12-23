FROM python:3.9-slim

WORKDIR /app

# Instalar dependencias del sistema para psycopg2 (postgres)
RUN apt-get update && apt-get install -y libpq-dev gcc

# Copiar requirements e instalar
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copiar el código
COPY . .

# Comando para iniciar la API
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
