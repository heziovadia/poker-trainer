import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // GitHub Pages serves the site under /poker-trainer/; everything else at the root.
  base: process.env.GITHUB_PAGES ? '/poker-trainer/' : '/',
  plugins: [react()],
  // strictPort: the saved data lives under http://localhost:5173, so the port must never change.
  server: { port: 5173, strictPort: true, host: true },
  test: { include: ['tests/**/*.test.ts'] },
} as never);
