import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Served from a project page as often as a root domain, so relative asset
  // URLs keep both working without a rebuild.
  base: './',
  server: { port: 3000 },
  build: { target: 'es2022', sourcemap: false },
});
