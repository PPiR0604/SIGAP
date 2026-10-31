import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 5183,
    watch: { ignored: ['**/test-results/**', '**/playwright-report/**', '**/.playwright-mcp/**'] },
    proxy: { '/api': { target: 'http://127.0.0.1:8797', changeOrigin: true } },
  },
});
