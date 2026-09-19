import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Split stable vendor code into its own long-lived chunks. Vendor
        // code rarely changes, so these stay in the browser's cache across
        // deploys — repeat launches (especially iOS Home Screen cold starts)
        // only re-download the small app chunk, not the whole bundle.
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('@mui') || id.includes('@emotion')) return 'mui';
          if (id.includes('firebase')) return 'firebase';
          // Charts are only used inside lazily-loaded pages — keep them out
          // of the eager vendor chunk so boot doesn't pay for them.
          if (id.includes('recharts') || /[\\/]d3[-/]/.test(id)) return 'charts';
          // These are only reached via dynamic import / lazy pages — letting
          // them fall through keeps them in their own on-demand chunks
          // instead of the eager vendor bundle.
          if (id.includes('jspdf') || id.includes('lottie-web') || id.includes('html2canvas')) return;
          if (id.includes('react-dom') || id.includes('react-router') || /[\\/]react[\\/]/.test(id)) return 'react-vendor';
          if (id.includes('socket.io')) return 'socket';
          return 'vendor';
        },
      },
    },
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../shared'),
      '@hospital-erp/shared': path.resolve(__dirname, '../shared'),
    },
  },
  server: {
    port: 5174,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
