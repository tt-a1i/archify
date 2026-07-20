// Golden-file harness for the archify renderers. No test framework needed:
// renderers are deterministic, so fresh renders must match the checked-in
// example HTML aside from platform checkout line endings. Also covers schema enforcement (negative cases),
// template freshness of the architecture-mode example, and version sync.
//
// Run from the skill folder: npm test

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(skillRoot, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-test-'));

let failures = 0;

function check(name, ok, detail) {
  if (ok) {
    console.log(`  ok    ${name}`);
  } else {
    failures += 1;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function render(mode, inputPath, outPath) {
  execFileSync('node', [
    path.join(skillRoot, `renderers/${mode}/render-${mode}.mjs`),
    inputPath,
    outPath,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
}

function normalizeNewlines(text) {
  return text.replace(/\r\n?/g, '\n');
}

// ---------------------------------------------------------------------------
console.log('golden renders (renderer output must match checked-in examples)');

const GOLDEN = [
  ['workflow', 'agent-tool-call.workflow.json', 'workflow-agent-tool-call-rendered.html'],
  ['sequence', 'cache-miss-request.sequence.json', 'sequence-cache-miss-request.html'],
  ['dataflow', 'product-analytics.dataflow.json', 'dataflow-product-analytics.html'],
  ['lifecycle', 'agent-run.lifecycle.json', 'lifecycle-agent-run.html'],
  ['architecture', 'web-app.architecture.json', 'web-app-rendered.html'],
];

for (const [mode, input, golden] of GOLDEN) {
  const out = path.join(tmp, golden);
  try {
    render(mode, path.join(skillRoot, 'examples', input), out);
    const fresh = fs.readFileSync(out, 'utf8');
    const checked = fs.readFileSync(path.join(repoRoot, 'examples', golden), 'utf8');
    check(`${mode}: ${golden}`, normalizeNewlines(fresh) === normalizeNewlines(checked),
      `fresh render differs from examples/${golden}; if the change is intentional, re-render the examples and commit them`);
  } catch (err) {
    check(`${mode}: ${golden}`, false, String(err.stderr || err.message).slice(0, 300));
  }
}

// ---------------------------------------------------------------------------
console.log('schema enforcement (invalid JSON must fail with a path-prefixed message)');

function expectFailure(name, mode, mutate, expectInMessage) {
  const base = JSON.parse(fs.readFileSync(
    path.join(skillRoot, 'examples', GOLDEN.find(([m]) => m === mode)[1]), 'utf8'));
  mutate(base);
  const input = path.join(tmp, `neg-${name.replace(/[^a-z0-9]+/gi, '-')}.json`);
  fs.writeFileSync(input, JSON.stringify(base));
  try {
    render(mode, input, path.join(tmp, 'neg-out.html'));
    check(name, false, 'renderer exited 0 on invalid input');
  } catch (err) {
    const message = String(err.stderr || err.message);
    check(name, message.includes(expectInMessage),
      `expected "${expectInMessage}" in:\n${message.slice(0, 300)}`);
  }
}

expectFailure('card dot outside enum', 'workflow',
  (d) => { d.cards[0].dot = 'pink'; }, '/cards/0/dot');
expectFailure('node id starting with a digit', 'workflow',
  (d) => { d.nodes[0].id = '1user'; }, 'pattern');
expectFailure('extra property rejected', 'workflow',
  (d) => { d.nodes[0].colour = 'red'; }, 'additional properties');
expectFailure('column beyond layout maximum', 'workflow',
  (d) => { d.nodes[0].col = 7; }, '<= 5');
expectFailure('missing schema_version', 'sequence',
  (d) => { delete d.schema_version; }, 'schema_version');
expectFailure('cross-lane state overlap', 'lifecycle',
  (d) => {
    const approval = d.states.find((s) => s.id === 'approval');
    const failed = d.states.find((s) => s.id === 'failed');
    delete failed.yOffset;
    failed.col = approval.col;
  }, 'less than 10px apart');
expectFailure('zero component width rejected by schema', 'architecture',
  (d) => { d.components[0].size = [0, 60]; }, '/components/0/size/0');
expectFailure('zero component height rejected by schema', 'architecture',
  (d) => { d.components[0].size = [120, 0]; }, '/components/0/size/1');
expectFailure('negative component width rejected by schema', 'architecture',
  (d) => { d.components[0].size = [-1, 60]; }, '/components/0/size/0');

// ---------------------------------------------------------------------------
console.log('template freshness (architecture example must carry the current template)');

function blocks(html, tag) {
  const re = new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, 'g');
  return html.match(re) || [];
}

const template = fs.readFileSync(path.join(skillRoot, 'assets/template.html'), 'utf8');
const webApp = fs.readFileSync(path.join(repoRoot, 'examples/web-app.html'), 'utf8');
// <style> and <script> blocks pass through applyTemplate untouched, so the
// architecture-mode example must contain them verbatim or it has drifted.
for (const tag of ['style', 'script']) {
  // The guided-view JSON script is generated from meta.views; compare only
  // template-owned executable scripts, not per-diagram data payloads.
  const isTemplateOwned = (block) => !block.includes('type="application/json"');
  const t = blocks(template, tag).filter((b) => !b.includes('[PROJECT NAME]') && isTemplateOwned(b));
  const w = blocks(webApp, tag).filter((b) => !b.includes('Sample Web App') && isTemplateOwned(b));
  check(`web-app.html ${tag} blocks match template`,
    JSON.stringify(t) === JSON.stringify(w),
    'examples/web-app.html was generated from a stale template — re-derive it');
}

// ---------------------------------------------------------------------------
console.log('version sync');

const pkg = JSON.parse(fs.readFileSync(path.join(skillRoot, 'package.json'), 'utf8'));
check('template generator meta matches package.json version',
  template.includes(`<meta name="generator" content="archify ${pkg.version}">`),
  `package.json says ${pkg.version}`);

const lock = JSON.parse(fs.readFileSync(path.join(skillRoot, 'package-lock.json'), 'utf8'));
check('package-lock.json version matches package.json',
  lock.version === pkg.version && lock.packages?.['']?.version === pkg.version,
  `lockfile says ${lock.version} — run npm install and rebuild the zip`);

const skillMd = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
const skillVersion = (skillMd.match(/^\s*version:\s*"([^"]+)"/m) || [])[1];
check('SKILL.md metadata version matches package.json major.minor',
  !!skillVersion && pkg.version.startsWith(skillVersion),
  `SKILL.md says ${skillVersion}, package.json says ${pkg.version}`);

for (const readmeName of ['README.md', 'README_EN.md', 'README_ZH.md']) {
  const readme = fs.readFileSync(path.join(repoRoot, readmeName), 'utf8');
  check(`${readmeName} badge matches package.json version`,
    readme.includes(`/badge/version-${pkg.version}-`),
    `${readmeName} does not advertise ${pkg.version}`);
}

const landingPage = fs.readFileSync(path.join(repoRoot, 'docs/index.html'), 'utf8');
const landingVersions = [...landingPage.matchAll(/\bv\d+\.\d+\.\d+\b/g)].map((m) => m[0]);
check('GitHub Pages version labels match package.json',
  landingVersions.length > 0 && landingVersions.every((v) => v === `v${pkg.version}`),
  `landing page says ${[...new Set(landingVersions)].join(', ') || '(no version)'}`);

// ---------------------------------------------------------------------------
fs.rmSync(tmp, { recursive: true, force: true });
if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nall checks passed');
