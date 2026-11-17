import { createHash } from 'node:crypto';

export const PACK_START = '<!-- archify-pr-pack:start -->';
export const PACK_END = '<!-- archify-pr-pack:end -->';
export const RISK_VERDICTS = ['SAFE', 'LOW RISK', 'MERGEABLE', 'NO IMPACT', 'VERIFIED PR'];
const CHANGE_GLYPH = { added: '+ added', modified: '~ modified', removed: '− removed', unchanged: '· unchanged' };

export function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

export function assetPlaceholder(assetId) {
  return `{{archify:asset:${assetId}}}`;
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/\r?\n/g, ' ');
}

// Risk verdicts are never produced by Archify; refuse to repeat authored ones.
export function findRiskVerdict(text) {
  const haystack = String(text ?? '');
  for (const verdict of RISK_VERDICTS) {
    const pattern = new RegExp(`(?<![A-Za-z])${verdict.replace(' ', '[\\s_-]+')}(?![A-Za-z])`, 'i');
    if (pattern.test(haystack)) return verdict;
  }
  return null;
}

export function assertNoRiskVerdict(text, subject) {
  const verdict = findRiskVerdict(text);
  if (verdict) {
    const error = new Error(`${subject} contains the risk verdict "${verdict}"; Archify reports evidence, not verdicts.`);
    error.code = 'pr-pack/risk-verdict';
    error.verdict = verdict;
    throw error;
  }
}

// GitHub renders a stray underline below the image unless <a>, <picture>
// and </picture></a> stay on one line.
export function themedPicture({ light, dark, alt }) {
  return `<a href="${escapeAttr(light)}"><picture><source media="(prefers-color-scheme: dark)" srcset="${escapeAttr(dark)}"><img alt="${escapeAttr(alt)}" src="${escapeAttr(light)}"></picture></a>`;
}

export function renderImage({ platform, light, dark, alt }) {
  if (platform === 'github' && light && dark) return themedPicture({ light, dark, alt });
  const single = light || dark;
  return `![${alt.replace(/[\[\]]/g, ' ')}](${single})`;
}

function renderStats(stats) {
  const entries = Object.entries(stats || {});
  if (!entries.length) return '';
  return entries.map(([key, value]) => `<code>${escapeHtml(key)}: ${value}</code>`).join(' · ');
}

function renderRevisions(pack) {
  const { baseSha, headSha, baseRef, headRef } = pack;
  const refs = baseRef && headRef ? `<code>${escapeHtml(baseRef)}...${escapeHtml(headRef)}</code>` : '';
  const shas = baseSha && headSha ? `<code>${baseSha.slice(0, 7)}</code> → <code>${headSha.slice(0, 7)}</code>` : '';
  if (!refs && !shas) return '';
  return `Diff: ${[refs, shas].filter(Boolean).join(' · ')} (three-dot, merge-base)`;
}

function changeRow(row) {
  const cells = [
    `<td style="white-space: nowrap"><code>${escapeHtml(row.subject)}</code></td>`,
    `<td style="white-space: nowrap">${escapeHtml(row.kind || '')}</td>`,
    `<td style="white-space: nowrap">${CHANGE_GLYPH[row.change]}</td>`,
    `<td>${escapeHtml(row.detail || '')}</td>`,
    `<td style="white-space: nowrap">${row.view ? `<code>${escapeHtml(row.view)}</code>` : ''}</td>`,
  ];
  return `<tr>${cells.join('')}</tr>`;
}

function changeTable(rows) {
  return [
    '<table>',
    '<thead><tr><th>Subject</th><th>Kind</th><th>Change</th><th>Detail</th><th>View</th></tr></thead>',
    `<tbody>${rows.map(changeRow).join('')}</tbody>`,
    '</table>',
  ].join('\n');
}

export function renderChangeTable(changes, limit) {
  if (!changes?.length) return '';
  const visible = changes.slice(0, limit);
  const folded = changes.slice(limit);
  const parts = [`### Changes (${changes.length})`, '', changeTable(visible)];
  if (folded.length) {
    parts.push('', `<details><summary>More changes <kbd>+${folded.length}</kbd></summary>`, '', changeTable(folded), '', '</details>');
  }
  return parts.join('\n');
}

function viewAssets(view, assets) {
  const light = assets[`${view.id}-light`];
  const dark = assets[`${view.id}-dark`];
  return { light, dark };
}

function storyAssetsFor(story, assets, manifestTheme = 'both') {
  const storyId = story.id || 'walkthrough';
  const single = assets[storyId];
  const light = assets[`${storyId}-light`] || (manifestTheme === 'light' ? single : undefined);
  const dark = assets[`${storyId}-dark`] || (manifestTheme === 'dark' ? single : undefined);
  return { light: light || single, dark };
}

// Renders the anchored pack block. `assets` maps "<view>-<theme>" to a URL or
// placeholder; the same composer runs before and after upload.
export function renderPackMarkdown(pack, assets) {
  const { manifest, platform } = pack;
  const story = pack.story ?? manifest.story ?? null;
  const checked = [
    ['title', manifest.title],
    ['summary', manifest.summary],
    ...(story ? [
      ['story/title', story.title],
      ['story/caption', story.caption],
      ...(story.steps || []).flatMap((step, index) => [[`story/steps/${index}/title`, step.title], [`story/steps/${index}/body`, step.body]]),
      ...(story.detail ? [['story/detail/title', story.detail.title], ['story/detail/note', story.detail.note]] : []),
    ] : []),
    ...pack.views.flatMap((view) => [[`views/${view.id}/title`, view.title], [`views/${view.id}/caption`, view.caption]]),
    ...(manifest.changes || []).flatMap((row, index) => [[`changes/${index}/subject`, row.subject], [`changes/${index}/detail`, row.detail]]),
  ];
  for (const [field, text] of checked) assertNoRiskVerdict(text, `manifest ${field}`);
  const lines = [PACK_START, `## ${manifest.title}`, ''];
  if (manifest.summary) lines.push(manifest.summary, '');
  const stats = renderStats(manifest.stats);
  if (stats) lines.push(stats, '');
  const revisions = renderRevisions(pack);
  if (revisions) lines.push(revisions, '');
  if (story) {
    const { light, dark } = storyAssetsFor(story, assets, pack.storyTheme || manifest.theme || 'both');
    const storyAlt = `${story.title || manifest.title} (animated walkthrough)`;
    if (story.caption) lines.push(story.caption, '');
    lines.push(renderImage({ platform, light, dark, alt: storyAlt }), '');
  }
  for (const view of pack.views) {
    if (view.storyOnly) continue;
    const { light, dark } = viewAssets(view, assets);
    const image = renderImage({ platform, light, dark, alt: `${view.title} (${view.type} diagram)` });
    if (view.collapsed) {
      lines.push(`<details><summary><b>${escapeHtml(view.title)}</b></summary>`, '');
      if (view.caption) lines.push(view.caption, '');
      lines.push(image, '', '</details>', '');
    } else {
      lines.push(`### ${view.title}`, '');
      if (view.caption) lines.push(view.caption, '');
      lines.push(image, '');
    }
  }
  const table = renderChangeTable(manifest.changes, pack.changeTableLimit);
  if (table) lines.push(table, '');
  lines.push('<sub>Diagrams generated by Archify from change-marked JSON; removed items stay in place as ghosts. Counts are objective evidence, not a review verdict.</sub>', PACK_END);
  return lines.join('\n');
}

export function packPlaceholderAssets(pack) {
  const assets = {};
  const story = pack.story ?? pack.manifest?.story ?? null;
  const platform = pack.platform || 'github';
  if (story) {
    const storyId = story.id || 'walkthrough';
    const rawTheme = pack.storyTheme || pack.manifest?.theme || 'both';
    const effective = platform === 'github' ? rawTheme : (rawTheme === 'both' ? 'light' : rawTheme);
    const themes = effective === 'both' ? ['light', 'dark'] : [effective];
    for (const theme of themes) assets[`${storyId}-${theme}`] = assetPlaceholder(`${storyId}-${theme}`);
  }
  for (const view of pack.views) {
    if (view.storyOnly) continue;
    const themes = view.theme === 'both' ? ['light', 'dark'] : [view.theme];
    for (const theme of themes) assets[`${view.id}-${theme}`] = assetPlaceholder(`${view.id}-${theme}`);
  }
  return assets;
}

export function fillAssets(markdown, urls) {
  const missing = new Set();
  const filled = markdown.replace(/\{\{archify:asset:([A-Za-z0-9_.-]+)\}\}/g, (match, assetId) => {
    if (urls[assetId]) return urls[assetId];
    missing.add(assetId);
    return match;
  });
  return { markdown: filled, missing: [...missing] };
}

export function locatePackBlock(body) {
  const text = String(body ?? '');
  const start = text.indexOf(PACK_START);
  if (start === -1) return null;
  const end = text.indexOf(PACK_END, start + PACK_START.length);
  if (end === -1) return null;
  return { start, end: end + PACK_END.length };
}

// Replaces only the anchored region so hand-written context, checklists and
// review replies around it survive every re-run.
export function replacePackBlock(body, block) {
  const text = String(body ?? '');
  const region = locatePackBlock(text);
  if (region) return `${text.slice(0, region.start)}${block}${text.slice(region.end)}`;
  const trimmed = text.replace(/\s+$/, '');
  return trimmed ? `${trimmed}\n\n${block}\n` : `${block}\n`;
}
