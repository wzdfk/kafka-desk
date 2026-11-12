import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// Dev server proxies /api to the Express backend (npm start) so SSE and
// relative fetches work unchanged during development.
export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:18761',
        changeOrigin: true,
        // SSE keeps a long-lived connection; never let the proxy time it out.
        timeout: 0,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
});
