import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import vueDevTools from 'vite-plugin-vue-devtools'

// 单一版本事实源：根 package.json（Q3）。构建时注入，浏览器/桌面端同一值。
const APP_VERSION = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
).version;

// Dev server proxies /api to the Express backend (npm start) so SSE and
// relative fetches work unchanged during development.
export default defineConfig({
    define: { __APP_VERSION__: JSON.stringify(APP_VERSION) },
    plugins: [
        vue(),
        vueDevTools({
            launchEditor: 'codebuddy'
        })
    ],
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
