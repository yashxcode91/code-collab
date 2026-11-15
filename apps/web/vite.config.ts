import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import tailwindConfig from './tailwind.config.js';

export default defineConfig({
  plugins: [react()],
  css: {
    postcss: {
      plugins: [tailwindcss(tailwindConfig), autoprefixer()],
    },
  },
  resolve: {
    alias: {
      // Allows clean `@/...` imports pointing directly to `apps/web/src`
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // Bridge `y-monaco`'s legacy ESM subpath into `monaco-editor@0.57` package exports
      'monaco-editor/esm/vs/editor/editor.api.js':
        'monaco-editor/editor/editor.api.js',
    },
  },
  server: {
    port: 5173,
    // Proxy `/api` and `/socket.io` requests in dev so frontend, REST, and WebSockets share
    // the `localhost:5173` origin, preserving HttpOnly auth cookies without CORS headaches.
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/monaco-editor')) {
            return 'monaco-vendor';
          }
          if (
            id.includes('node_modules/react') ||
            id.includes('node_modules/react-dom') ||
            id.includes('node_modules/react-router-dom')
          ) {
            return 'react-vendor';
          }
          if (id.includes('node_modules/@tanstack/react-query')) {
            return 'query-vendor';
          }
          if (id.includes('node_modules/lucide-react')) {
            return 'icons-vendor';
          }
        },
      },
    },
  },
});
