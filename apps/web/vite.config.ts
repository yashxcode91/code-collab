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
});
