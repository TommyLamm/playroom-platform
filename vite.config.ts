import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist/client', emptyOutDir: true },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // The API validates the browser-facing Host against PLATFORM_ORIGIN.
      '/api': { target: 'http://127.0.0.1:3000', changeOrigin: false },
    },
  },
});
