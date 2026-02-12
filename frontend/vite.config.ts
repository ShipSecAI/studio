import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const apiTarget = process.env.VITE_API_URL || 'http://localhost:3211';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Force single React instance for all packages
    },
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    include: ['react', 'react-dom', '@radix-ui/react-accordion'],
    esbuildOptions: {
      // Ensure React is treated as external in dependencies
      resolveExtensions: ['.jsx', '.tsx', '.js', '.ts'],
    },
  },
  server: {
    host: '0.0.0.0',
    open: false,
    allowedHosts: ['studio.shipsec.ai', 'frontend'],
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
        secure: false,
      },
      '/analytics': {
        target: 'http://localhost:5601',
        changeOrigin: true,
        secure: false,
      },
    },
  },
  preview: {
    allowedHosts: ['studio.shipsec.ai', 'frontend'],
  },
});
