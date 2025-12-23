import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Esto expone la aplicación a la red de Docker (0.0.0.0)
    host: true, 
    // Forzamos el puerto 3000 para que coincida con lo que expusimos en Dockerfile y docker-compose
    port: 3000,
    // Si el puerto 3000 está ocupado, fallará en lugar de cambiarlo silenciosamente (bueno para debugging)
    strictPort: true,
    watch: {
      // Necesario para que el Hot Reload funcione correctamente en sistemas de archivos montados (Docker Volumes)
      usePolling: true,
    }
  }
})
