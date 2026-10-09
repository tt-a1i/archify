export function siteTarget(value = process.env.ARCHIFY_SITE_TARGET) {
  if (value === undefined || value === '' || value === 'github') {
    return { name: 'github', site: 'https://tt-a1i.github.io', base: '/archify', outDir: './dist' };
  }
  if (value === 'cloudflare') {
    return { name: 'cloudflare', site: 'https://archify.si', base: '/', outDir: './dist-cloudflare' };
  }
  throw new Error(`Unknown ARCHIFY_SITE_TARGET: ${value}`);
}
