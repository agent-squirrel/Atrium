import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/admin',
  server: {
    port: 5173,
    allowedHosts: ['127.0.0.1', 'localhost', '::1'],
    // Forward API/backend requests to the dockerized stack (nginx on :80)
    // so `npm run dev` works against a running `docker compose up` without
    // needing CORS on the Flask app - the browser only ever talks to :5173.
    proxy: {
      '/api': 'http://localhost',
      '/p': 'http://localhost',
      '/static': 'http://localhost',
      '/guest': 'http://localhost',
    },
  },
})
