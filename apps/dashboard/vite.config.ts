import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
/** When 3001 is taken, run API with PORT=3002 and `LEADIYA_API_ORIGIN=http://localhost:3002 npm run dev`. */
const apiOrigin = process.env.LEADIYA_API_ORIGIN ?? 'http://localhost:3001'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    proxy: {
      '/api': {
        target: apiOrigin,
        changeOrigin: true,
      },
    },
  },
})
