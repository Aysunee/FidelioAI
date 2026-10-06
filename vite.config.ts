import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// No `define` for secrets here: anything injected into the client bundle is public.
// AI calls go through the backend (/api/analyze); only non-secret VITE_* variables reach the frontend.
export default defineConfig({
  server: {
    // PORT is set by the preview launcher when 3000 is taken (e.g. another session's dev server).
    port: Number(process.env.PORT) || 3000,
    // 0.0.0.0 exposes the dev server (and its /api proxy) to the local network, e.g. for phone testing.
    // Set DEV_HOST=127.0.0.1 to keep it on this machine only.
    host: process.env.DEV_HOST || '0.0.0.0',
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
      },
      '/health': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
      }
    }
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    }
  }
});
