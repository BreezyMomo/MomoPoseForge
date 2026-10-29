import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  root: 'web', plugins: [react()],
  build: { outDir: '../dist', emptyOutDir: true, chunkSizeWarningLimit: 900,
    rollupOptions: { output: { manualChunks: { three: ['three'], react: ['react', 'react-dom'] } } },
  },
});
