import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const instance = parseInt(process.env.SHIPSEC_INSTANCE || '0', 10);
const frontendPort = 5173 + instance * 100;
const backendPort = 3211 + instance * 100;

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
    port: frontendPort,
    strictPort: true,
    open: false,
    allowedHosts: ['studio.shipsec.ai', 'frontend'],
    proxy: {
      '/api/': {
        target: `http://localhost:${backendPort}`,
        changeOrigin: true,
        secure: false,
      },
      '/analytics/': {
        target: 'http://localhost:5601',
        changeOrigin: true,
        secure: false,
      },
    },
  },
  preview: {
    allowedHosts: ['studio.shipsec.ai', 'frontend'],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-radix': [
            '@radix-ui/react-accordion',
            '@radix-ui/react-avatar',
            '@radix-ui/react-checkbox',
            '@radix-ui/react-dialog',
            '@radix-ui/react-dropdown-menu',
            '@radix-ui/react-label',
            '@radix-ui/react-popover',
            '@radix-ui/react-select',
            '@radix-ui/react-slider',
            '@radix-ui/react-slot',
            '@radix-ui/react-switch',
            '@radix-ui/react-tabs',
            '@radix-ui/react-tooltip',
          ],
          'vendor-analytics': ['posthog-js'],
        },
      },
    },
  },
});
