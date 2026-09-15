import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  CARD_MARKER,
  classifyPath,
  createGhFetch,
  detectTemplateSections,
  escapeInline,
  extractLinkedIssues,
  findCardComment,
  paginate,
  referencesIssue,
  renderCard,
  summarizeFiles,
} from './pr-triage-card.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = readFileSync(path.join(here, '..', 'PULL_REQUEST_TEMPLATE.md'), 'utf8');

test('classifyPath follows the governance classification table', () => {
  const cases = {
    'docs/assets/x.png': 'generated-site',
    'docs/gallery/foo/index.html': 'generated-site',
    'docs/gallery.html': 'generated-site',
    'docs/guide.html': 'generated-site',
    'docs/start.html': 'generated-site',
    'docs/index.html': 'generated-site',
    'docs/cases/one.html': 'generated-site',
    'docs/cases/nested/one.html': 'docs',
    'docs/foo.md': 'docs',
    'docs/research/report.json': 'docs',
    'archify.zip': 'package',
    'archify/examples/web-app.html': 'golden-examples',
    'examples/web-app.html': 'golden-examples',
    'archify/examples/nested/web-app.html': 'source',
    'archify/renderers/shared/generated-validators.mjs': 'generated-source',
    'archify/renderers/shared/validator.mjs': 'source',
    'archify/test/x.test.mjs': 'tests',
    'benchmarks/run.mjs': 'tests',
    '.github/workflows/ci.yml': 'governance',
    '.github/CURRENT_FOCUS.md': 'governance',
    'CONTRIBUTING.md': 'governance',
    'REVIEWING.md': 'governance',
    'SECURITY.md': 'governance',
    '.coderabbit.yaml': 'governance',
    'README.md': 'docs',
    'archify/README.md': 'docs',
    'archify/cli.mjs': 'source',
    'scripts/build-zip.sh': 'source',
  };
  for (const [file, expected] of Object.entries(cases)) {
    assert.equal(classifyPath(file), expected, file);
  }
});

test('summarizeFiles counts per class and subtracts generated churn', () => {
  const files = [
    { filename: 'archify/cli.mjs', additions: 10, deletions: 2 },
    { filename: 'archify/test/cli.test.mjs', additions: 5, deletions: 0 },
    { filename: 'docs/gallery/a.html', additions: 100, deletions: 50 },
    { filename: 'archify.zip', additions: 0, deletions: 0 },
    { filename: 'archify/examples/web-app.html', additions: 7, deletions: 7 },
    { filename: 'archify/renderers/shared/generated-validators.mjs', additions: 3, deletions: 1 },
  ];
  const summary = summarizeFiles(files);
  assert.equal(summary.counts.source, 1);
  assert.equal(summary.counts.tests, 1);
  assert.equal(summary.counts['generated-site'], 1);
  assert.equal(summary.counts.package, 1);
  assert.equal(summary.counts['golden-examples'], 1);
  assert.equal(summary.counts['generated-source'], 1);
  assert.equal(summary.additions, 125);
  assert.equal(summary.deletions, 60);
  assert.equal(summary.additionsExcludingGenerated, 15);
  assert.equal(summary.deletionsExcludingGenerated, 2);
  assert.equal(summary.hasLabelClass, true);

  const withTotals = summarizeFiles(files.slice(0, 1), { additions: 500, deletions: 400 });
  assert.equal(withTotals.additions, 500);
  assert.equal(withTotals.additionsExcludingGenerated, 500);
  assert.equal(withTotals.hasLabelClass, false);

  const sourceOnly = summarizeFiles([{ filename: 'archify/renderers/shared/generated-x.mjs', additions: 1, deletions: 1 }]);
  assert.equal(sourceOnly.hasLabelClass, false, 'generated-source alone does not trigger the label');
});

test('extractLinkedIssues prioritises closing keywords and dedupes', () => {
  const linked = extractLinkedIssues(
    'Tighten validator (#12)',
    'Fixes #7 and closes #12. Related to #99 and tt-a1i/archify#7.\nResolves: #8',
  );
  assert.deepEqual(linked, [7, 12, 8, 99]);
});

test('extractLinkedIssues ignores code fences, inline code, comments and URLs', () => {
  const body = [
    'See https://github.com/tt-a1i/archify/pull/12 and https://example.com/#55',
    '```',
    'fixes #31',
    '```',
    'Inline `#32` is code. <!-- fixes #33 -->',
    'Real: #34',
  ].join('\n');
  assert.deepEqual(extractLinkedIssues('No refs here', body), [34]);
  assert.deepEqual(extractLinkedIssues('', 'issue#41 is not a ref, but #42 is'), [42]);
  assert.deepEqual(extractLinkedIssues('', 'nothing'), []);
  assert.deepEqual(extractLinkedIssues(null, undefined), []);
});

test('referencesIssue matches the exact number only', () => {
  assert.equal(referencesIssue('Follow-up for #12', 12), true);
  assert.equal(referencesIssue('Follow-up for #120', 12), false);
  assert.equal(referencesIssue('Follow-up for #1', 12), false);
  assert.equal(referencesIssue('see https://x.test/#12', 12), false);
  assert.equal(referencesIssue('`#12`', 12), false);
});

test('detectTemplateSections distinguishes filled, empty and missing sections', () => {
  const body = [
    '## Problem and value',
    '',
    'Current-main trigger or rationale, intended outcome, approach, and linked issue/agreed scope:',
    'Fixes the layout drift described in #12.',
    '',
    '## Stability impact',
    '',
    '- Impact class and changed behavior/shared callers: <!-- CONTRIBUTING.md#choose-evidence-by-impact -->',
    '- Existing behavior preserved / intended compatibility changes / failure behavior:',
    '- No unrelated changes: <!-- confirm or explain -->',
    '',
    '## Tests run',
    '',
    '<!-- I will fill this in later -->',
    '',
    '## Visual evidence',
    '',
    'Not applicable: CLI-only change.',
    '',
  ].join('\n');
  const sections = detectTemplateSections(body, TEMPLATE);
  assert.deepEqual(sections, [
    { name: 'Problem and value', present: true, filled: true },
    { name: 'Stability impact', present: true, filled: false },
    { name: 'Tests run', present: true, filled: false },
    { name: 'Visual evidence', present: true, filled: true },
    { name: 'Generated artifacts', present: false, filled: false },
  ]);
});

test('detectTemplateSections treats an untouched template as all empty', () => {
  const sections = detectTemplateSections(TEMPLATE, TEMPLATE);
  assert.ok(sections.every((s) => s.present && !s.filled));
});

test('detectTemplateSections returns null when the template is not used', () => {
  assert.equal(detectTemplateSections('Just a sentence.', TEMPLATE), null);
  assert.equal(detectTemplateSections('', TEMPLATE), null);
  assert.equal(detectTemplateSections(null, TEMPLATE), null);
  assert.equal(detectTemplateSections('## Unrelated heading\ntext', TEMPLATE), null);
});

test('findCardComment locates the marker among other comments', () => {
  const comments = [
    { id: 1, body: 'Looks good.' },
    { id: 2, body: null },
    { id: 3, body: `${CARD_MARKER}\n### Triage card` },
    { id: 4, body: `${CARD_MARKER}\nold duplicate` },
  ];
  assert.equal(findCardComment(comments).id, 3);
  assert.equal(findCardComment([{ id: 9, body: 'no marker' }]), null);
  assert.equal(findCardComment([]), null);
  assert.equal(findCardComment(undefined), null);
});

test('escapeInline truncates and neutralises heading injection', () => {
  const long = 'x'.repeat(150);
  assert.equal(escapeInline(long).length, 100);
  assert.ok(escapeInline(long).endsWith('…'));
  assert.equal(escapeInline('# fake heading\n## another'), '\\# fake heading ## another');
  assert.equal(escapeInline('<!-- marker -->'), '&lt;!-- marker -->');
});

function baseModel(overrides = {}) {
  return {
    headSha: 'abcdef1234567890',
    draft: false,
    files: summarizeFiles([{ filename: 'archify/cli.mjs', additions: 3, deletions: 1 }]),
    linkedIssues: [],
    overlaps: [],
    overlapError: false,
    templateSections: null,
    notes: [],
    ...overrides,
  };
}

test('renderCard with no linked issue and no template', () => {
  const card = renderCard(baseModel());
  assert.ok(card.startsWith(CARD_MARKER));
  assert.match(card, /^### Triage card$/m);
  assert.match(card, /Head `abcdef1` · ready · \+3\/−1 total, \+3\/−1 excluding generated paths/);
  assert.match(card, /No linked issue\. Narrow fixes may proceed on their reproduction/);
  assert.match(card, /No other open PR references these issues\./);
  assert.match(card, /^PR template not used\.$/m);
  assert.ok(!card.includes('Each changed golden'));
  assert.ok(!card.includes('Notes:'));
  assert.match(card, /Advisory index for reviewers; it makes no acceptance decision\./);
  assert.ok(card.split('\n').length <= 40);
});

test('renderCard lists linked issues, overlaps, template state and notes', () => {
  const card = renderCard(
    baseModel({
      draft: true,
      linkedIssues: [
        { number: 12, title: '# Heading-like title', labels: ['bug', 'accepted'] },
        { number: 13, title: 'Plain', labels: [] },
        { number: 14, error: 'GET /repos/x/issues/14 → 404' },
      ],
      linkedIssuesTruncated: 2,
      overlaps: [{ number: 40, title: 'Other PR', primary: true, issues: [12] }],
      templateSections: [
        { name: 'Problem and value', present: true, filled: true },
        { name: 'Stability impact', present: true, filled: false },
        { name: 'Tests run', present: false, filled: false },
      ],
      notes: ['changed files not listed (GET → 500)'],
    }),
  );
  assert.match(card, /· draft ·/);
  assert.match(card, /- #12 \\# Heading-like title — labels: bug, accepted — carries `accepted`/);
  assert.match(card, /- #13 Plain — labels: none — no `accepted` label/);
  assert.match(card, /- #14 — not fetched/);
  assert.match(card, /\+2 more referenced issues not fetched/);
  assert.match(card, /- #40 Other PR \(references #12\) — carries `primary-implementation`/);
  assert.match(card, /Template sections: Problem and value ✓ · Stability impact — empty · Tests run — missing/);
  assert.match(card, /^Notes: changed files not listed/m);
  assert.ok(!/^#{1,6} /m.test(card.replace('### Triage card', '')), 'no injected headings');
});

test('renderCard reports search failure and caps generated path lists', () => {
  const generated = Array.from({ length: 20 }, (_, i) => ({ filename: `docs/gallery/case-${i}.html`, additions: 1, deletions: 1 }));
  const files = summarizeFiles([
    ...generated,
    { filename: 'archify/examples/web-app.html', additions: 2, deletions: 2 },
    { filename: 'archify/cli.mjs', additions: 5, deletions: 0 },
  ]);
  const card = renderCard(
    baseModel({
      files,
      filesTruncated: true,
      linkedIssues: [{ number: 1, title: 'x', labels: [] }],
      overlapError: true,
    }),
  );
  assert.match(card, /Overlap check unavailable \(search API error\)/);
  assert.match(card, /- generated-site \(20\): `docs\/gallery\/case-0\.html`, .* … \+5 more$/m);
  assert.equal((card.match(/docs\/gallery\/case-/g) ?? []).length, 15);
  assert.match(card, /- golden-examples \(1\): `archify\/examples\/web-app\.html`/);
  assert.match(card, /Each changed golden must be explained by the behavior change that produced it/);
  assert.match(card, /only the first 300 files were classified/);
  assert.match(card, /\+27\/−22 total, \+5\/−0 excluding generated paths/);
});

test('ghFetch sets headers, retries once on 5xx and honours allowed statuses', async () => {
  const calls = [];
  let attempt = 0;
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    attempt += 1;
    if (attempt === 1) return { ok: false, status: 502, text: async () => 'bad gateway', headers: new Map() };
    if (url.endsWith('/missing')) return { ok: false, status: 404, text: async () => '', headers: new Map() };
    return { ok: true, status: 200, text: async () => '{"ok":true}', headers: new Map() };
  };
  const ghFetch = createGhFetch({ token: 't', fetchImpl, sleep: async () => {} });
  const first = await ghFetch('/repos/o/r/pulls/1');
  assert.equal(first.status, 200);
  assert.deepEqual(first.json, { ok: true });
  assert.equal(calls.length, 2, 'retried once after 502');
  assert.equal(calls[0].url, 'https://api.github.com/repos/o/r/pulls/1');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer t');
  assert.equal(calls[0].init.headers.Accept, 'application/vnd.github+json');
  assert.equal(calls[0].init.headers['X-GitHub-Api-Version'], '2022-11-28');

  const missing = await ghFetch('/missing', { method: 'DELETE', allow: [404] });
  assert.equal(missing.status, 404);
  await assert.rejects(() => ghFetch('/missing'), /404/);
});

test('paginate follows Link headers until the last page', async () => {
  const pages = {
    1: { items: Array.from({ length: 100 }, (_, i) => i), link: '<x>; rel="next"' },
    2: { items: [100, 101], link: '' },
  };
  const ghFetch = async (p) => {
    const page = Number(new URL(`https://x${p}`).searchParams.get('page'));
    return { json: pages[page].items, headers: new Map([['link', pages[page].link]]) };
  };
  const all = await paginate(ghFetch, '/repos/o/r/issues/1/comments');
  assert.equal(all.length, 102);
  const capped = await paginate(ghFetch, '/repos/o/r/pulls/1/files?x=1', { maxPages: 1 });
  assert.equal(capped.length, 100);
});
