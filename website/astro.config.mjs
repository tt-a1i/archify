import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://tt-a1i.github.io',
  base: '/archify',
  output: 'static',
  publicDir: './.public',
  compressHTML: false,
  build: { format: 'file' },
  integrations: [react()],
  vite: { plugins: [tailwindcss()] },
});
