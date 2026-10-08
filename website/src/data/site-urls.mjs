export const canonicalOrigin = 'https://archify.si';
export const sitePages = ['index', 'guide', 'start', 'gallery', 'community'];
export function canonicalPath(page, lang = 'en') {
  return page === 'index' ? (lang === 'zh' ? '/zh' : '/') : `${lang === 'zh' ? '/zh/' : '/'}${page}`;
}
export function canonicalUrl(page, lang = 'en') {
  return new URL(canonicalPath(page, lang), canonicalOrigin).href;
}
// Paths are relative to the site's root <base>, so exported files also work on file://.
export function localPagePath(page, lang = 'en', cloudflare = false) {
  if (page === 'index') return lang === 'zh' ? 'zh' + (cloudflare ? '' : '.html') : './';
  return `${lang === 'zh' ? 'zh/' : ''}${page}${cloudflare ? '' : '.html'}`;
}
