// In-page update notice for delivered HTML.
//
// The notice is decided once, locally, at delivery time from the update
// cache that the bounded delivery check maintains. The page itself never
// contacts the network or reports anything; it only carries the versions and
// the official release-notes link that were already validated locally.

import {
  compareSemver,
  isStableCoreVersion,
  parseSemver,
  validateReleaseNotesUrl,
} from '../scripts/update-contract.mjs';

export const UPDATE_NOTICE_ENV = 'ARCHIFY_DELIVERY_UPDATE_NOTICE';
export const UPDATE_NOTICE_DISABLED_ENV = 'ARCHIFY_UPDATE_NOTICE_DISABLED';
export const UPDATE_NOTICE_ATTRIBUTE = 'data-archify-update-notice';
const DEFAULT_READ_TIMEOUT_MS = 500;

// Validate every field again: the notice may come from a parent process
// (finalize) and is written into a page that people share.
export function validUpdateNotice(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { installedVersion, availableVersion, severity = 'normal' } = value;
  try {
    if (typeof installedVersion !== 'string') return null;
    parseSemver(installedVersion);
    if (!isStableCoreVersion(availableVersion)) return null;
    if (compareSemver(availableVersion, installedVersion) <= 0) return null;
    if (!['normal', 'security'].includes(severity)) return null;
    const releaseNotes = validateReleaseNotesUrl(
      value.releaseNotes ?? `https://github.com/tt-a1i/archify/releases/tag/v${availableVersion}`,
      availableVersion,
    );
    return { installedVersion, availableVersion, severity, releaseNotes };
  } catch {
    return null;
  }
}

// Only a notice the user would also be told about qualifies: snoozed,
// ignored, current, or unavailable results never produce page content.
export function updateNoticeFromResult(result) {
  if (result?.status !== 'update_available' || result.noticeRequired !== true) return null;
  return validUpdateNotice({
    installedVersion: result.installedVersion,
    availableVersion: result.latestVersion ?? result.availableVersion,
    severity: result.severity,
    releaseNotes: result.releaseNotes,
  });
}

export function parseSuppliedUpdateNotice(text) {
  if (typeof text !== 'string' || text.length > 1_024) return null;
  try {
    return validUpdateNotice(JSON.parse(text));
  } catch {
    return null;
  }
}

async function defaultReadCached(options) {
  const { readCachedUpdate } = await import('../scripts/check-update.mjs');
  return readCachedUpdate(options);
}

export async function resolveUpdateNotice({
  env = process.env,
  optOut = false,
  timeoutMs = DEFAULT_READ_TIMEOUT_MS,
  readCached = defaultReadCached,
} = {}) {
  if (optOut || env[UPDATE_NOTICE_DISABLED_ENV] === '1') return null;
  // finalize disables the delivery child's own network check and supplies the
  // notice it read with the caller's environment instead.
  if (Object.hasOwn(env, UPDATE_NOTICE_ENV)) return parseSuppliedUpdateNotice(env[UPDATE_NOTICE_ENV]);
  if (env.ARCHIFY_UPDATE_CHECK_DISABLED === '1') return null;
  let timer;
  try {
    const result = await Promise.race([
      readCached({
        ...(env.ARCHIFY_UPDATE_RELEASE_PATH ? { releasePath: env.ARCHIFY_UPDATE_RELEASE_PATH } : {}),
        ...(env.ARCHIFY_UPDATE_CACHE_DIRECTORY ? { cacheDirectory: env.ARCHIFY_UPDATE_CACHE_DIRECTORY } : {}),
      }),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
        timer.unref?.();
      }),
    ]);
    return updateNoticeFromResult(result);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const MESSAGES = {
  en: {
    made: (version) => `Made with Archify ${version}`,
    available: (version) => `${version} available`,
    security: (version) => `security update ${version} available`,
    notes: 'Release notes',
    dismiss: 'Dismiss update notice',
    region: 'Archify update',
  },
  'zh-Hans': {
    made: (version) => `由 Archify ${version} 生成`,
    available: (version) => `新版本 ${version} 可用`,
    security: (version) => `安全更新 ${version} 可用`,
    notes: '更新说明',
    dismiss: '关闭更新提醒',
    region: 'Archify 更新',
  },
  'zh-Hant': {
    made: (version) => `由 Archify ${version} 產生`,
    available: (version) => `新版本 ${version} 可用`,
    security: (version) => `安全性更新 ${version} 可用`,
    notes: '更新說明',
    dismiss: '關閉更新提醒',
    region: 'Archify 更新',
  },
  ja: {
    made: (version) => `Archify ${version} で作成`,
    available: (version) => `${version} が利用可能`,
    security: (version) => `セキュリティ更新 ${version} が利用可能`,
    notes: 'リリースノート',
    dismiss: '更新のお知らせを閉じる',
    region: 'Archify の更新',
  },
  ko: {
    made: (version) => `Archify ${version}(으)로 생성됨`,
    available: (version) => `${version} 사용 가능`,
    security: (version) => `보안 업데이트 ${version} 사용 가능`,
    notes: '릴리스 노트',
    dismiss: '업데이트 알림 닫기',
    region: 'Archify 업데이트',
  },
};

export function updateNoticeLocale(html) {
  const tag = /<html\b[^>]*>/i.exec(html)?.[0] || '';
  const lang = (/\slang\s*=\s*["']?([A-Za-z0-9-]+)/i.exec(tag)?.[1] || '').toLowerCase();
  if (/^zh-(?:hant|tw|hk|mo)\b/.test(lang)) return 'zh-Hant';
  if (lang.startsWith('zh')) return 'zh-Hans';
  if (lang === 'ja' || lang.startsWith('ja-')) return 'ja';
  if (lang === 'ko' || lang.startsWith('ko-')) return 'ko';
  return 'en';
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

// A small footer line after the page content: it never overlays the diagram,
// reader rails, or Viewer controls, is not part of the SVG that Viewer exports
// clone, and is hidden for print and presentation. Inside the Viewer footer it
// is part of the space the adaptive reader already keeps below the first
// screen, so the diagram layout is unchanged. Dismissal is CSS-only, so the
// page needs no script, storage, or network for it.
const NOTICE_STYLE = `.archify-update-notice{display:flex;justify-content:center;box-sizing:border-box;width:100%;margin:16px 0 20px;grid-column:1/-1;flex:1 0 100%;font:500 11px/1.45 ui-sans-serif,system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;letter-spacing:0;text-align:center}
.page-feedback>.archify-update-notice{margin:0}
.archify-update-notice__pill{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;column-gap:8px;row-gap:2px;box-sizing:border-box;max-width:calc(100% - 32px);padding:2px 2px 2px 12px;border:1px solid rgba(100,116,139,.30);border-radius:14px;background:rgba(255,255,255,.88);color:#475569}
.archify-update-notice__link{color:#0f766e;text-decoration:underline;text-underline-offset:2px}
.archify-update-notice__close{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:999px;color:#64748b;cursor:pointer;font-size:14px;line-height:1}
.archify-update-notice__close:hover{background:rgba(100,116,139,.16)}
.archify-update-notice__close:focus-within{outline:2px solid #0f766e;outline-offset:1px}
.archify-update-notice__dismiss{position:absolute;width:1px;height:1px;margin:0;opacity:0;pointer-events:none}
.archify-update-notice:has(.archify-update-notice__dismiss:checked){display:none}
html[data-theme="dark"] .archify-update-notice__pill{background:rgba(15,23,42,.80);color:#cbd5e1;border-color:rgba(148,163,184,.28)}
html[data-theme="dark"] .archify-update-notice__link{color:#5eead4}
html[data-theme="dark"] .archify-update-notice__close{color:#94a3b8}
@media (prefers-color-scheme:dark){html:not([data-theme]) .archify-update-notice__pill{background:rgba(15,23,42,.80);color:#cbd5e1;border-color:rgba(148,163,184,.28)}html:not([data-theme]) .archify-update-notice__link{color:#5eead4}}
html[data-present="true"] .archify-update-notice,html[data-embed="true"] .archify-update-notice{display:none}
@media print{.archify-update-notice{display:none!important}}`;

export function updateNoticeMarkup(notice, locale = 'en') {
  const valid = validUpdateNotice(notice);
  if (!valid) return '';
  const text = MESSAGES[locale] || MESSAGES.en;
  const status = valid.severity === 'security' ? text.security(valid.availableVersion) : text.available(valid.availableVersion);
  return `<style data-archify-update-notice-style="">${NOTICE_STYLE}</style>
<div class="archify-update-notice no-print" ${UPDATE_NOTICE_ATTRIBUTE}="" data-installed-version="${escapeHtml(valid.installedVersion)}" data-available-version="${escapeHtml(valid.availableVersion)}" role="note" aria-label="${escapeHtml(text.region)}"><div class="archify-update-notice__pill"><span class="archify-update-notice__text">${escapeHtml(text.made(valid.installedVersion))} · ${escapeHtml(status)}</span><a class="archify-update-notice__link" href="${escapeHtml(valid.releaseNotes)}" target="_blank" rel="noopener noreferrer">${escapeHtml(text.notes)}</a><label class="archify-update-notice__close" title="${escapeHtml(text.dismiss)}"><input class="archify-update-notice__dismiss" type="checkbox" aria-label="${escapeHtml(text.dismiss)}"><span aria-hidden="true">×</span></label></div></div>
`;
}

const VIEWER_FOOTER = /<footer\b[^>]*\bclass\s*=\s*"[^"]*\bpage-feedback\b[^"]*"[^>]*>/i;

// Prefer the end of the Viewer footer; otherwise insert before the
// document's closing body tag. A page without either is left unchanged
// rather than guessing where its content ends.
export function injectUpdateNotice(html, notice) {
  const markup = updateNoticeMarkup(notice, updateNoticeLocale(html));
  if (!markup) return { html, embedded: false };
  const lower = html.toLowerCase();
  const footer = VIEWER_FOOTER.exec(html);
  let index = footer ? lower.indexOf('</footer>', footer.index + footer[0].length) : -1;
  if (index < 0) index = lower.lastIndexOf('</body>');
  if (index < 0) return { html, embedded: false };
  return { html: `${html.slice(0, index)}${markup}${html.slice(index)}`, embedded: true };
}

// Browser evidence describes the diagram, not this delivery-time notice.
export const REMOVE_UPDATE_NOTICE_SCRIPT = `for (var archifyUpdateNotice; (archifyUpdateNotice = document.querySelector('[${UPDATE_NOTICE_ATTRIBUTE}],[data-archify-update-notice-style]'));) archifyUpdateNotice.remove();`;
