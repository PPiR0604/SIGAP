import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 5183,
    proxy: { '/api': { target: 'http://127.0.0.1:8797', changeOrigin: true } },
  },
});
