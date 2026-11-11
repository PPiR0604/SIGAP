import { defineConfig } from 'vite';
import {fileURLToPath} from 'node:url';

export default defineConfig({
  resolve: {alias: {'@': fileURLToPath(new URL('.', import.meta.url))}},
  server: {
    host: '127.0.0.1',
    port: 5173,
    watch: { ignored: ['**/test-results/**', '**/playwright-report/**', '**/.playwright-mcp/**'] },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true
      }
    }
  }
});
