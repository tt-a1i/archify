// In-page update notice for delivered HTML.
//
// The notice is decided once, locally, at delivery time from the update
// cache that the bounded delivery check maintains. The page itself never
// contacts the network or reports anything. The copy prompt is local text
// with only the validated available version interpolated.

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
    available: (version) => `Archify ${version} available`,
    security: (version) => `Archify security update ${version}`,
    notes: 'Notes',
    copy: 'Copy update prompt',
    copied: 'Copied for Agent',
    prompt: (version) => `Update my installed Archify skill to ${version} (confirm my current install method and scope first, then follow https://archify.si/llms.txt).`,
    dismiss: 'Dismiss update notice',
    region: 'Archify update',
  },
  'zh-Hans': {
    available: (version) => `Archify ${version} 可用`,
    security: (version) => `Archify 安全更新 ${version}`,
    notes: '说明',
    copy: '复制更新指令',
    copied: '已复制，可发给 Agent',
    prompt: (version) => `请帮我把已安装的 Archify 更新到 ${version}（先确认当前安装方式和范围，再按 https://archify.si/llms.txt 执行更新）。`,
    dismiss: '关闭更新提醒',
    region: 'Archify 更新',
  },
  'zh-Hant': {
    available: (version) => `Archify ${version} 可用`,
    security: (version) => `Archify 安全性更新 ${version}`,
    notes: '說明',
    copy: '複製更新指令',
    copied: '已複製，可發給 Agent',
    prompt: (version) => `請幫我把已安裝的 Archify 更新到 ${version}（先確認目前的安裝方式與範圍，再依 https://archify.si/llms.txt 執行更新）。`,
    dismiss: '關閉更新提醒',
    region: 'Archify 更新',
  },
  ja: {
    available: (version) => `Archify ${version} 利用可能`,
    security: (version) => `Archify セキュリティ更新 ${version}`,
    notes: '詳細',
    copy: '更新プロンプトをコピー',
    copied: 'コピー済み、Agent に送信',
    prompt: (version) => `インストール済みの Archify を ${version} に更新してください（まず現在のインストール方法と範囲を確認し、https://archify.si/llms.txt に従って更新してください）。`,
    dismiss: '更新のお知らせを閉じる',
    region: 'Archify の更新',
  },
  ko: {
    available: (version) => `Archify ${version} 사용 가능`,
    security: (version) => `Archify 보안 업데이트 ${version}`,
    notes: '안내',
    copy: '업데이트 프롬프트 복사',
    copied: '복사됨, Agent에 보내기',
    prompt: (version) => `설치된 Archify를 ${version}(으)로 업데이트해 주세요 (먼저 현재 설치 방식과 범위를 확인한 뒤 https://archify.si/llms.txt 안내에 따라 업데이트해 주세요).`,
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

// Start in the footer. On wide Viewer pages the row shrinks to its contents
// so its box includes the title and any preset badge without taking the gap.
const MIN_HEADER_WIDTH = 1080;
const NOTICE_STYLE = `.archify-update-notice{display:flex;justify-content:center;box-sizing:border-box;width:100%;margin:16px 0 20px;grid-column:1/-1;flex:1 0 100%;font:500 11px/1.45 ui-sans-serif,system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;letter-spacing:0;text-align:center}
.page-feedback>.archify-update-notice{margin:0}
.archify-update-notice[data-header]{position:absolute;width:max-content;margin:0;z-index:10}
.archify-update-notice__pill{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;column-gap:8px;row-gap:2px;box-sizing:border-box;width:max-content;max-width:calc(100% - 32px);padding:2px 2px 2px 12px;border:1px solid rgba(100,116,139,.30);border-radius:14px;background:rgba(255,255,255,.88);color:#475569}
.archify-update-notice[data-header] .archify-update-notice__pill{flex-wrap:nowrap;max-width:none;white-space:nowrap}
.archify-update-notice__link,.archify-update-notice__copy{color:#0f766e;text-decoration:underline;text-underline-offset:2px}
.archify-update-notice__copy{font:inherit;background:none;border:0;padding:0;cursor:pointer}
.archify-update-notice__close{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:999px;color:#64748b;cursor:pointer;font-size:14px;line-height:1}
.archify-update-notice__close:hover{background:rgba(100,116,139,.16)}
.archify-update-notice__close:focus-within{outline:2px solid currentColor;outline-offset:1px}
.archify-update-notice__dismiss{position:absolute;width:1px;height:1px;margin:0;opacity:0;pointer-events:none}
.archify-update-notice:has(.archify-update-notice__dismiss:checked){display:none}
html[data-theme="dark"] .archify-update-notice__pill{background:rgba(15,23,42,.80);color:#cbd5e1;border-color:rgba(148,163,184,.28)}
html[data-theme="dark"] :is(.archify-update-notice__link,.archify-update-notice__copy){color:#5eead4}
html[data-theme="dark"] .archify-update-notice__close{color:#94a3b8}
@media (prefers-color-scheme:dark){html:not([data-theme]) .archify-update-notice__pill{background:rgba(15,23,42,.80);color:#cbd5e1;border-color:rgba(148,163,184,.28)}html:not([data-theme]) :is(.archify-update-notice__link,.archify-update-notice__copy){color:#5eead4}}
html .archify-update-notice[data-header] .archify-update-notice__pill{border-color:color-mix(in srgb,var(--panel-border,#94a3b8) 85%,transparent);background:color-mix(in srgb,var(--panel,#fff) 78%,transparent);box-shadow:0 1px 2px rgba(15,23,42,.04),0 8px 20px -14px rgba(15,23,42,.22);backdrop-filter:blur(12px)}
html[data-present="true"] .archify-update-notice,html[data-embed="true"] .archify-update-notice{display:none}
@media (min-width:${MIN_HEADER_WIDTH}px){html:not([data-present="true"], [data-embed="true"]):has(.archify-update-notice[data-viewer]) .header-row{width:fit-content;max-width:100%}}
@media print{.archify-update-notice{display:none!important}}`;

// All interpolated text is escaped in HTML attributes outside the script.
export const NOTICE_SCRIPT = `(() => {
  const notice = document.currentScript.parentElement;
  const copy = notice.querySelector('.archify-update-notice__copy');
  const label = copy.firstElementChild;
  const originalLabel = label.textContent;
  let resetLabel;
  copy.hidden = false;
  copy.addEventListener('click', async () => {
    const prompt = copy.dataset.prompt;
    try {
      await navigator.clipboard.writeText(prompt);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = prompt;
      textarea.readOnly = true;
      textarea.style.cssText = 'position:fixed;inset:0 auto auto 0;opacity:0';
      document.body.append(textarea);
      textarea.focus({ preventScroll: true });
      textarea.select();
      try {
        if (!document.execCommand('copy')) return;
      } catch {
        return;
      } finally {
        textarea.remove();
        copy.focus({ preventScroll: true });
      }
    }
    label.textContent = copy.dataset.copiedLabel;
    copy.dataset.copied = 'true';
    clearTimeout(resetLabel);
    resetLabel = setTimeout(() => {
      label.textContent = originalLabel;
      delete copy.dataset.copied;
    }, 2000);
  });

  const header = document.querySelector('.header');
  const toolbar = document.querySelector('.toolbar');
  const title = header?.querySelector('h1');
  const root = document.documentElement;
  if (!title || !toolbar || root.matches('[data-archify-artifact="explainer"], [data-hosted="explainer"]')) return;
  const row = title.closest('.header-row') || title;
  const footer = notice.parentElement;
  notice.dataset.viewer = '';
  const wide = matchMedia('(min-width: ${MIN_HEADER_WIDTH}px)');
  const pill = notice.firstElementChild;
  function dock() {
    if (!notice.isConnected) {
      observer.disconnect();
      return;
    }
    const box = pill.getBoundingClientRect();
    if (!box.width) return;
    const heading = row.getBoundingClientRect();
    const left = Math.max(heading.right, title.getBoundingClientRect().right) + 12;
    const right = toolbar.getBoundingClientRect().left - 12;
    if (!wide.matches || right - left < box.width) {
      if (notice.hasAttribute('data-header')) {
        delete notice.dataset.header;
        footer.append(notice);
      }
      return;
    }
    notice.style.left = (left + (right - left - box.width) / 2 + scrollX) + 'px';
    notice.style.top = (heading.top + (heading.height - box.height) / 2 + scrollY) + 'px';
    if (!notice.hasAttribute('data-header')) {
      notice.dataset.header = '';
      document.body.append(notice);
    }
  }
  const observer = new ResizeObserver(() => requestAnimationFrame(dock));
  for (const element of new Set([root, header, row, title, toolbar, pill])) observer.observe(element);
})();`;

const NOTICE_START = '<!-- archify-update-notice:start -->';
const NOTICE_END = '<!-- archify-update-notice:end -->';
const NOTICE_BLOCK = /<!-- archify-update-notice:start -->[\s\S]*?<!-- archify-update-notice:end -->\n?/;

export function updateNoticeMarkup(notice, locale = 'en') {
  const valid = validUpdateNotice(notice);
  if (!valid) return '';
  const text = Object.hasOwn(MESSAGES, locale) ? MESSAGES[locale] : MESSAGES.en;
  const status = valid.severity === 'security' ? text.security(valid.availableVersion) : text.available(valid.availableVersion);
  return `${NOTICE_START}<style data-archify-update-notice-style="">${NOTICE_STYLE}</style>
<div class="archify-update-notice no-print" ${UPDATE_NOTICE_ATTRIBUTE}="" data-installed-version="${escapeHtml(valid.installedVersion)}" data-available-version="${escapeHtml(valid.availableVersion)}" role="note" aria-label="${escapeHtml(text.region)}"><div class="archify-update-notice__pill"><span class="archify-update-notice__text">↑ ${escapeHtml(status)}</span><button class="archify-update-notice__copy" type="button" hidden data-prompt="${escapeHtml(text.prompt(valid.availableVersion))}" data-copied-label="${escapeHtml(text.copied)}"><span aria-live="polite">${escapeHtml(text.copy)}</span></button><a class="archify-update-notice__link" href="${escapeHtml(valid.releaseNotes)}" target="_blank" rel="noopener noreferrer">${escapeHtml(text.notes)}</a><label class="archify-update-notice__close" title="${escapeHtml(text.dismiss)}"><input class="archify-update-notice__dismiss" type="checkbox" aria-label="${escapeHtml(text.dismiss)}"><span aria-hidden="true">×</span></label></div><script>${NOTICE_SCRIPT}</script></div>${NOTICE_END}
`;
}

const VIEWER_FOOTER = /<footer\b[^>]*\bclass\s*=\s*"[^"]*\bpage-feedback\b[^"]*"[^>]*>/i;

// Prefer the end of the Viewer footer; otherwise insert before the
// document's closing body tag. A page without either is left unchanged
// rather than guessing where its content ends.
export function injectUpdateNotice(html, notice) {
  const markup = updateNoticeMarkup(notice, updateNoticeLocale(html));
  if (!markup) return { html, embedded: false };
  if (NOTICE_BLOCK.test(html)) return { html: html.replace(NOTICE_BLOCK, () => markup), embedded: true };
  // Match on the original string: case-folding can change its length
  // (e.g. Turkish U+0130), which would shift offsets into the runtime.
  const footer = VIEWER_FOOTER.exec(html);
  let index = -1;
  if (footer) {
    const closing = /<\/footer\s*>/gi;
    closing.lastIndex = footer.index + footer[0].length;
    const match = closing.exec(html);
    if (match) index = match.index;
  }
  if (index < 0) {
    for (const match of html.matchAll(/<\/body\s*>/gi)) index = match.index;
  }
  if (index < 0) return { html, embedded: false };
  return { html: `${html.slice(0, index)}${markup}${html.slice(index)}`, embedded: true };
}

// Browser evidence describes the diagram, not this delivery-time notice.
export const REMOVE_UPDATE_NOTICE_SCRIPT = `for (var archifyUpdateNotice; (archifyUpdateNotice = document.querySelector('[${UPDATE_NOTICE_ATTRIBUTE}],[data-archify-update-notice-style]'));) archifyUpdateNotice.remove();`;
