import { defineConfig } from 'vite';
import { resolve } from 'node:path';
export default defineConfig({ base: './', build: { target: 'chrome120', rollupOptions: {
  input: { index: resolve('index.html'), background: resolve('src/background.js') },
  output: { entryFileNames: chunk => chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js' }
} }, server: { port: 5173, strictPort: true } });
