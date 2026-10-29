import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      chunkSizeWarningLimit: 4500,
      rollupOptions: {
        output: {
          manualChunks: { monaco: ['monaco-editor'] },
        },
      },
    },
    server: {
      port: 32231,
      strictPort: true,
      // Dedicated HMR port — vite's default 24678 collides with other
      // middleware-mode projects running on this machine.
      hmr: process.env.DISABLE_HMR !== 'true' ? { port: 32239 } : false,
      // Go backend (pnpm dev:backend) — API + socket.io over ws/polling.
      proxy: {
        '/api': 'http://localhost:32230',
        '/socket.io': { target: 'http://localhost:32230', ws: true },
      },
    },
  };
});
