import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { TanStackRouterVite } from '@tanstack/router-plugin/vite';

export default defineConfig({
  plugins: [TanStackRouterVite(), react()],
  server: {
    port: 5273,
    proxy: { '/api': 'http://127.0.0.1:4317' },
  },
  build: { outDir: 'dist' },
});
