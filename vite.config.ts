import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Served from a project page as often as a root domain, so relative asset
  // URLs keep both working without a rebuild.
  base: './',
  server: { host: '0.0.0.0', port: 3000, allowedHosts: true },
  // The sandbox exposes previews through a generated hostname that is not
  // known at build time. This is only used by the local preview server.
  preview: { host: '0.0.0.0', port: 3000, allowedHosts: true },
  build: { target: 'es2022', sourcemap: false },
});
