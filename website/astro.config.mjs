import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import { writeFileSync } from 'node:fs';
import { siteTarget } from './scripts/site-target.mjs';
import { publishSeo } from './scripts/publish-seo.mjs';
import { fileURLToPath } from 'node:url';

const target = siteTarget();
const publishSearchMetadata = {
  name: 'archify-publish-search-metadata',
  hooks: { 'astro:build:done': ({ dir }) => publishSeo(fileURLToPath(dir), target) },
};
const cloudflareNotFound = {
  name: 'archify-cloudflare-not-found',
  hooks: {
    'astro:build:done': ({ dir }) => {
      writeFileSync(new URL('404.html', dir), '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Page not found — Archify</title><meta name="robots" content="noindex"></head><body><main><h1>Page not found</h1><p><a href="/">Return to Archify</a></p></main></body></html>\n');
    },
  },
};

export default defineConfig({
  site: target.site,
  base: target.base,
  outDir: target.outDir,
  output: 'static',
  publicDir: './.public',
  compressHTML: false,
  build: { format: 'file' },
  integrations: [react(), publishSearchMetadata, ...(target.name === 'cloudflare' ? [cloudflareNotFound] : [])],
  vite: { plugins: [tailwindcss()] },
});
