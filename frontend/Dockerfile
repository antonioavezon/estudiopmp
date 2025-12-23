FROM node:18-alpine

WORKDIR /app

# Copiamos el package.json corregido
COPY package.json .

# Instalamos las dependencias
RUN npm install

# Copiamos el resto del código
COPY . .

# Exponemos el puerto 3000
EXPOSE 3000

# Iniciamos Vite en modo host para que sea visible desde fuera del contenedor
CMD ["npm", "run", "dev", "--", "--host"]
