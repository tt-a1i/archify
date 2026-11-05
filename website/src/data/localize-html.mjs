import { parseFragment, serialize } from 'parse5';
import { localPagePath } from './site-urls.mjs';

export function localizeHtml(html, { lang, page, cloudflare, copy = {} }) {
  const tree = parseFragment(html);
  function walk(node) {
    const attrs = new Map((node.attrs || []).map(item => [item.name, item]));
    const get = name => attrs.get(name)?.value;
    const set = (name, value) => {
      if (attrs.has(name)) attrs.get(name).value = value;
      else { const attr = { name, value }; node.attrs.push(attr); attrs.set(name, attr); }
    };
    if (node.tagName === 'script' && get('src') === 'assets/site-language.js') {
      node.parentNode.childNodes = node.parentNode.childNodes.filter(child => child !== node);
      return;
    }
    const key = get('data-i18n') || get('data-i18n-html');
    const value = key ? copy[lang]?.[key] : get(`data-${lang}`);
    if (typeof value === 'string') {
      // Only authored dictionary strings or explicit markup may contain HTML.
      const markup = key || get('data-translation-html') !== undefined || page === 'gallery';
      node.childNodes = markup ? parseFragment(value).childNodes : [{ nodeName: '#text', value, parentNode: node }];
      for (const child of node.childNodes) child.parentNode = node;
    }
    const placeholder = copy[lang]?.[get('data-i18n-placeholder')];
    if (typeof placeholder === 'string') set('placeholder', placeholder);
    if (get('data-language-switch') !== undefined) {
      set('href', localPagePath(page, lang === 'zh' ? 'en' : 'zh', cloudflare));
      set('hreflang', lang === 'zh' ? 'en' : 'zh-Hans');
      set('aria-label', lang === 'zh' ? 'Switch to English' : '切换到中文');
      node.childNodes = [{ nodeName: '#text', value: lang === 'zh' ? 'EN' : '中文', parentNode: node }];
    } else if (node.tagName === 'a') {
      const href = get('href');
      const match = href?.match(/^(?:(index|guide|start|gallery|community)\.html|(\.\/))([?#].*)?$/);
      if (match) set('href', localPagePath(match[1] || 'index', lang, cloudflare) + (match[3] || ''));
      else if (href?.startsWith('#')) set('href', localPagePath(page, lang, cloudflare) + href);
    }
    for (const child of [...(node.childNodes || [])]) walk(child);
  }
  walk(tree);
  return serialize(tree);
}
