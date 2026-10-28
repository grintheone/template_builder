import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL('../../', import.meta.url)), 'API_');
  const apiPort = process.env.API_PORT ?? env.API_PORT ?? '3001';
  if (!/^\d+$/.test(apiPort) || Number(apiPort) < 1 || Number(apiPort) > 65535) throw new Error('Invalid API_PORT');
  return {
    plugins: [react(), tailwindcss()],
    resolve: { alias: { '@': resolve(fileURLToPath(new URL('.', import.meta.url)), 'src') } },
    server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy: { '/api': { target: `http://127.0.0.1:${apiPort}` } } },
    preview: { host: '127.0.0.1', port: 4173, strictPort: true, proxy: { '/api': { target: `http://127.0.0.1:${apiPort}` } } },
  };
});
