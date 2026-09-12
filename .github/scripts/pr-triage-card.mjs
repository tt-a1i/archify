// PR triage card: an advisory evidence index for reviewers plus review-state
// label maintenance. Pure functions are exported for tests; the IO shell at
// the bottom only reads the event payload, calls the GitHub REST API, and
// upserts one comment. It never executes PR-supplied code.

import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const CARD_MARKER = '<!-- archify-triage-card -->';
export const GENERATED_CLASSES = new Set(['generated-site', 'package', 'golden-examples', 'generated-source']);
export const LABEL_CLASSES = new Set(['generated-site', 'package', 'golden-examples']);
export const CLASS_ORDER = ['source', 'tests', 'docs', 'governance', 'generated-source', 'golden-examples', 'generated-site', 'package'];
export const TEMPLATE_HEADINGS = [
  'Problem and value',
  'Stability impact',
  'Tests run',
  'Visual evidence',
  'Generated artifacts',
];
const MAX_LINKED_ISSUES = 5;
const MAX_FILES = 300;
const MAX_LISTED_PATHS = 15;
const MAX_TITLE = 100;

// --- Path classification (mirrors the table in the governance brief) --------

export function classifyPath(path) {
  const p = String(path).replace(/^\.\//, '');
  if (
    p.startsWith('docs/gallery/') ||
    p.startsWith('docs/assets/') ||
    /^docs\/(gallery|guide|start|index)\.html$/.test(p) ||
    /^docs\/cases\/[^/]+\.html$/.test(p)
  ) return 'generated-site';
  if (p === 'archify.zip') return 'package';
  if (/^(archify\/)?examples\/[^/]+\.html$/.test(p)) return 'golden-examples';
  if (/^archify\/renderers\/shared\/generated-[^/]+\.mjs$/.test(p)) return 'generated-source';
  if (p.startsWith('archify/test/') || p.startsWith('benchmarks/')) return 'tests';
  if (
    p.startsWith('.github/') ||
    ['CONTRIBUTING.md', 'REVIEWING.md', 'SECURITY.md', '.coderabbit.yaml'].includes(p)
  ) return 'governance';
  if (p.endsWith('.md') || p.startsWith('docs/')) return 'docs';
  return 'source';
}

export function summarizeFiles(files, totals = {}) {
  const byClass = Object.fromEntries(CLASS_ORDER.map((c) => [c, []]));
  let generatedAdditions = 0;
  let generatedDeletions = 0;
  let sumAdditions = 0;
  let sumDeletions = 0;
  for (const file of files) {
    const cls = classifyPath(file.filename);
    byClass[cls].push(file.filename);
    const add = Number(file.additions) || 0;
    const del = Number(file.deletions) || 0;
    sumAdditions += add;
    sumDeletions += del;
    if (GENERATED_CLASSES.has(cls)) {
      generatedAdditions += add;
      generatedDeletions += del;
    }
  }
  const additions = Number.isFinite(totals.additions) ? totals.additions : sumAdditions;
  const deletions = Number.isFinite(totals.deletions) ? totals.deletions : sumDeletions;
  return {
    byClass,
    counts: Object.fromEntries(CLASS_ORDER.map((c) => [c, byClass[c].length])),
    additions,
    deletions,
    additionsExcludingGenerated: Math.max(0, additions - generatedAdditions),
    deletionsExcludingGenerated: Math.max(0, deletions - generatedDeletions),
    hasLabelClass: [...LABEL_CLASSES].some((c) => byClass[c].length > 0),
  };
}

// --- Linked issues ----------------------------------------------------------

export function stripCodeAndUrls(text) {
  return String(text ?? '')
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\bhttps?:\/\/\S+/gi, ' ');
}

const CLOSING_RE = /\b(?:fix|fixes|fixed|close|closes|closed|resolve|resolves|resolved)\b:?\s+(?:[\w.-]+\/[\w.-]+)?#(\d+)/gi;
const REF_RE = /(?<![\w/&])#(\d+)\b/g;

export function extractLinkedIssues(title, body) {
  const cleanTitle = stripCodeAndUrls(title);
  const cleanBody = stripCodeAndUrls(body);
  const ordered = [];
  const seen = new Set();
  const push = (n) => {
    const num = Number(n);
    if (num > 0 && !seen.has(num)) {
      seen.add(num);
      ordered.push(num);
    }
  };
  for (const text of [cleanTitle, cleanBody]) {
    for (const m of text.matchAll(CLOSING_RE)) push(m[1]);
  }
  for (const m of cleanTitle.matchAll(/\(#(\d+)\)/g)) push(m[1]);
  for (const text of [cleanTitle, cleanBody]) {
    for (const m of text.matchAll(REF_RE)) push(m[1]);
  }
  return ordered;
}

export function referencesIssue(text, number) {
  const clean = stripCodeAndUrls(text);
  const re = new RegExp(`(?<![\\w/&])#${Number(number)}\\b`);
  return re.test(clean);
}

// --- PR template sections ---------------------------------------------------

function splitSections(markdown) {
  const sections = new Map();
  const text = String(markdown ?? '').replace(/\r\n/g, '\n');
  const headingRe = /^##\s+(.+?)\s*$/gm;
  const found = [...text.matchAll(headingRe)];
  for (let i = 0; i < found.length; i += 1) {
    const name = found[i][1].trim();
    const start = found[i].index + found[i][0].length;
    const end = i + 1 < found.length ? found[i + 1].index : text.length;
    if (!sections.has(name)) sections.set(name, text.slice(start, end));
  }
  return sections;
}

function contentLines(section) {
  return String(section ?? '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

// Returns null when none of the template headings appear in the body;
// otherwise an array of { name, present, filled } for each template heading.
export function detectTemplateSections(body, templateText = '') {
  const bodySections = splitSections(body);
  const templateSections = splitSections(templateText);
  const present = TEMPLATE_HEADINGS.filter((h) => bodySections.has(h));
  if (present.length === 0) return null;
  const placeholders = new Set();
  for (const section of templateSections.values()) {
    for (const line of contentLines(section)) placeholders.add(line);
  }
  return TEMPLATE_HEADINGS.map((name) => {
    if (!bodySections.has(name)) return { name, present: false, filled: false };
    const lines = contentLines(bodySections.get(name)).filter((line) => !placeholders.has(line));
    return { name, present: true, filled: lines.length > 0 };
  });
}

// --- Comment lookup ---------------------------------------------------------

export function findCardComment(comments) {
  return (comments ?? []).find((c) => typeof c?.body === 'string' && c.body.includes(CARD_MARKER)) ?? null;
}

// --- Rendering --------------------------------------------------------------

export function escapeInline(value, max = MAX_TITLE) {
  let text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (text.length > max) text = `${text.slice(0, max - 1)}…`;
  return text.replace(/</g, '&lt;').replace(/^#/, '\\#');
}

export function shortSha(sha) {
  return String(sha ?? '').slice(0, 7) || 'unknown';
}

function code(path) {
  return `\`${String(path).replace(/`/g, '')}\``;
}

function listPaths(paths) {
  const shown = paths.slice(0, MAX_LISTED_PATHS).map(code).join(', ');
  const rest = paths.length - MAX_LISTED_PATHS;
  return rest > 0 ? `${shown} … +${rest} more` : shown;
}

export function renderCard(model) {
  const {
    headSha,
    draft,
    files,
    linkedIssues = [],
    linkedIssuesTruncated = 0,
    overlaps = [],
    overlapError = false,
    templateSections = null,
    filesTruncated = false,
    notes = [],
  } = model;
  const lines = [CARD_MARKER, '### Triage card'];
  lines.push(
    `Head \`${shortSha(headSha)}\` · ${draft ? 'draft' : 'ready'} · ` +
      `+${files.additions}/−${files.deletions} total, ` +
      `+${files.additionsExcludingGenerated}/−${files.deletionsExcludingGenerated} excluding generated paths`,
  );

  lines.push('', '**Linked issues**');
  if (linkedIssues.length === 0) {
    lines.push(
      'No linked issue. Narrow fixes may proceed on their reproduction; contract-level changes need a linked issue or a recorded maintainer decision (CONTRIBUTING.md#choose-the-right-path).',
    );
  } else {
    for (const issue of linkedIssues) {
      if (issue.error) {
        lines.push(`- #${issue.number} — not fetched (${escapeInline(issue.error, 60)})`);
        continue;
      }
      const labels = (issue.labels ?? []).map((l) => escapeInline(l, 40));
      const accepted = labels.includes('accepted') ? 'carries `accepted`' : 'no `accepted` label';
      lines.push(
        `- #${issue.number} ${escapeInline(issue.title)} — labels: ${labels.length ? labels.join(', ') : 'none'} — ${accepted}`,
      );
    }
    if (linkedIssuesTruncated > 0) lines.push(`- … +${linkedIssuesTruncated} more referenced issues not fetched`);
  }

  lines.push('', '**Overlapping open PRs**');
  if (overlapError) {
    lines.push('Overlap check unavailable (search API error)');
  } else if (linkedIssues.length === 0 || overlaps.length === 0) {
    lines.push('No other open PR references these issues.');
  } else {
    for (const pr of overlaps) {
      const primary = pr.primary ? ' — carries `primary-implementation`' : '';
      lines.push(`- #${pr.number} ${escapeInline(pr.title)} (references #${pr.issues.join(', #')})${primary}`);
    }
  }

  lines.push('', '**Changed paths by class**');
  lines.push(CLASS_ORDER.map((c) => `${c} ${files.counts[c]}`).join(' · ') + (filesTruncated ? ` · only the first ${MAX_FILES} files were classified` : ''));
  for (const cls of ['generated-site', 'package', 'golden-examples', 'generated-source']) {
    const paths = files.byClass[cls];
    if (paths.length > 0) lines.push(`- ${cls} (${paths.length}): ${listPaths(paths)}`);
  }
  if (files.byClass['golden-examples'].length > 0) {
    lines.push('Each changed golden must be explained by the behavior change that produced it (CONTRIBUTING.md#packages-and-generated-artifacts).');
  }

  lines.push('');
  if (templateSections === null) {
    lines.push('PR template not used.');
  } else {
    const parts = templateSections.map((s) => {
      if (!s.present) return `${s.name} — missing`;
      return s.filled ? `${s.name} ✓` : `${s.name} — empty`;
    });
    lines.push(`Template sections: ${parts.join(' · ')}`);
  }

  if (notes.length > 0) {
    lines.push('', `Notes: ${notes.map((n) => escapeInline(n, 160)).join('; ')}`);
  }

  lines.push('', 'Advisory index for reviewers; it makes no acceptance decision. See REVIEWING.md and .github/CURRENT_FOCUS.md.');
  return lines.join('\n');
}

// --- IO shell ---------------------------------------------------------------

const API = 'https://api.github.com';

export function createGhFetch({ token, fetchImpl = globalThis.fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  return async function ghFetch(path, init = {}) {
    const url = path.startsWith('http') ? path : `${API}${path}`;
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'archify-pr-triage-card',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    };
    let response = await fetchImpl(url, { ...init, headers });
    if (response.status >= 500) {
      await sleep(1500);
      response = await fetchImpl(url, { ...init, headers });
    }
    const allow = init.allow ?? [];
    if (!response.ok && !allow.includes(response.status)) {
      const text = await response.text().catch(() => '');
      throw new Error(`${init.method ?? 'GET'} ${path} → ${response.status} ${text.replace(/\s+/g, ' ').slice(0, 200)}`);
    }
    let json = null;
    if (response.status !== 204) {
      const text = await response.text();
      json = text ? JSON.parse(text) : null;
    }
    return { status: response.status, headers: response.headers, json };
  };
}

export async function paginate(ghFetch, path, { maxPages = 10 } = {}) {
  const results = [];
  const sep = path.includes('?') ? '&' : '?';
  for (let page = 1; page <= maxPages; page += 1) {
    const { json, headers } = await ghFetch(`${path}${sep}per_page=100&page=${page}`);
    const items = Array.isArray(json) ? json : [];
    results.push(...items);
    const link = headers?.get?.('link') ?? '';
    if (items.length < 100 || !/rel="next"/.test(link)) break;
  }
  return results;
}

function readEvent() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) throw new Error('GITHUB_EVENT_PATH is not set');
  const event = JSON.parse(readFileSync(eventPath, 'utf8'));
  const number = event?.pull_request?.number;
  if (!Number.isInteger(number)) throw new Error('event payload has no pull_request.number');
  return event;
}

function hasWriteAccess(permissionPayload) {
  const permission = permissionPayload?.permission;
  const role = permissionPayload?.role_name;
  return ['admin', 'write', 'maintain'].includes(permission) || ['admin', 'write', 'maintain'].includes(role);
}

async function main() {
  const event = readEvent();
  const eventName = process.env.GITHUB_EVENT_NAME ?? '';
  const repo = process.env.GITHUB_REPOSITORY ?? event?.repository?.full_name;
  if (!repo) throw new Error('GITHUB_REPOSITORY is not set');
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN is not set');
  const ghFetch = createGhFetch({ token });
  const number = event.pull_request.number;
  const base = `/repos/${repo}`;
  const notes = [];

  let pr = event.pull_request;
  if (eventName === 'pull_request_review' || !Number.isFinite(pr?.additions)) {
    ({ json: pr } = await ghFetch(`${base}/pulls/${number}`));
  }
  const labelNames = new Set((pr.labels ?? []).map((l) => l.name));

  async function addLabel(name) {
    if (labelNames.has(name)) return;
    await ghFetch(`${base}/issues/${number}/labels`, { method: 'POST', body: JSON.stringify({ labels: [name] }) });
    labelNames.add(name);
  }
  async function removeLabel(name) {
    if (!labelNames.has(name)) return;
    await ghFetch(`${base}/issues/${number}/labels/${encodeURIComponent(name)}`, { method: 'DELETE', allow: [404] });
    labelNames.delete(name);
  }

  // 1. Review-state labels.
  try {
    if (eventName === 'pull_request_review' && event.review?.state === 'changes_requested') {
      const reviewer = event.review?.user?.login;
      const { json } = await ghFetch(`${base}/collaborators/${encodeURIComponent(reviewer)}/permission`);
      if (hasWriteAccess(json)) await addLabel('awaiting-author');
    } else if (eventName === 'pull_request_target' && event.action === 'synchronize') {
      await removeLabel('awaiting-author');
    }
  } catch (error) {
    notes.push(`awaiting-author label not updated (${error.message})`);
  }

  // 2. Changed files.
  let rawFiles = [];
  let filesTruncated = false;
  try {
    rawFiles = await paginate(ghFetch, `${base}/pulls/${number}/files`, { maxPages: MAX_FILES / 100 });
    filesTruncated = (pr.changed_files ?? rawFiles.length) > rawFiles.length;
  } catch (error) {
    notes.push(`changed files not listed (${error.message})`);
  }
  const files = summarizeFiles(rawFiles, { additions: pr.additions, deletions: pr.deletions });

  try {
    if (files.hasLabelClass) await addLabel('generated-artifacts');
    else await removeLabel('generated-artifacts');
  } catch (error) {
    notes.push(`generated-artifacts label not synced (${error.message})`);
  }

  // 3. Linked issues and overlapping PRs.
  const allLinked = extractLinkedIssues(pr.title, pr.body).filter((n) => n !== number);
  const linkedNumbers = allLinked.slice(0, MAX_LINKED_ISSUES);
  const linkedIssues = [];
  for (const n of linkedNumbers) {
    try {
      const { json } = await ghFetch(`${base}/issues/${n}`);
      if (json?.pull_request) {
        linkedIssues.push({ number: n, error: 'is a pull request, not an issue' });
        continue;
      }
      linkedIssues.push({ number: n, title: json.title, labels: (json.labels ?? []).map((l) => l.name) });
    } catch (error) {
      linkedIssues.push({ number: n, error: error.message });
    }
  }

  const overlaps = new Map();
  let overlapError = false;
  for (const issue of linkedIssues) {
    if (issue.error) continue;
    try {
      const q = encodeURIComponent(`repo:${repo} is:pr is:open ${issue.number}`);
      const { json } = await ghFetch(`/search/issues?q=${q}&per_page=50`);
      for (const item of json?.items ?? []) {
        if (item.number === number) continue;
        if (!referencesIssue(`${item.title}\n${item.body ?? ''}`, issue.number)) continue;
        const entry = overlaps.get(item.number) ?? {
          number: item.number,
          title: item.title,
          primary: (item.labels ?? []).some((l) => l.name === 'primary-implementation'),
          issues: [],
        };
        entry.issues.push(issue.number);
        overlaps.set(item.number, entry);
      }
    } catch {
      overlapError = true;
    }
  }

  // 4. Template sections.
  const templatePath = '.github/PULL_REQUEST_TEMPLATE.md';
  const templateText = existsSync(templatePath) ? readFileSync(templatePath, 'utf8') : '';
  const templateSections = detectTemplateSections(pr.body, templateText);

  // 5. Upsert the card.
  const body = renderCard({
    headSha: pr.head?.sha,
    draft: Boolean(pr.draft),
    files,
    filesTruncated,
    linkedIssues,
    linkedIssuesTruncated: Math.max(0, allLinked.length - linkedNumbers.length),
    overlaps: [...overlaps.values()],
    overlapError,
    templateSections,
    notes,
  });
  const comments = await paginate(ghFetch, `${base}/issues/${number}/comments`);
  const existing = findCardComment(comments);
  if (existing) {
    await ghFetch(`${base}/issues/comments/${existing.id}`, { method: 'PATCH', body: JSON.stringify({ body }) });
  } else {
    await ghFetch(`${base}/issues/${number}/comments`, { method: 'POST', body: JSON.stringify({ body }) });
  }
  console.log(`pr-triage-card: ${existing ? 'updated' : 'created'} card on #${number}${notes.length ? ` with ${notes.length} note(s)` : ''}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`pr-triage-card: ${error.message}`);
    process.exit(1);
  });
}
