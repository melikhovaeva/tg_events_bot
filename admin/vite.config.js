import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  root: path.resolve('./admin'),
  base: '/admin/',
  build: { outDir: 'dist', emptyOutDir: true },
});
