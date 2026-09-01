import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(skillRoot, '..');
const cli = path.join(skillRoot, 'bin', 'archify.mjs');

// Delivery-chain roots only. `experiments/` holds frozen scratch output with
// its own generators (visual-evolution/prototype.html is a 2.11.0 artifact),
// so it is not part of the contract the delivery pipeline maintains.
const artifactRoots = ['archify/examples', 'docs', 'examples'];

// Only subresource positions count. A repository-backed diagram cites source
// lines as anchors the reader clicks, and the SVG namespace is an identifier;
// neither is a request the page makes on open.
const SUBRESOURCE_PATTERNS = [
  /<link\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi,
  /\bsrc\s*=\s*["']([^"']+)["']/gi,
  /\bsrcset\s*=\s*["']([^"']+)["']/gi,
  /@import\s+(?:url\(\s*)?["']?([^"')\s;]+)/gi,
  /url\(\s*["']?((?:https?:)?\/\/[^"')\s]+)/gi,
];

const DIAGRAMS = [
  ['architecture', 'web-app.architecture.json'],
  ['workflow', 'agent-tool-call.workflow.json'],
  ['sequence', 'cache-miss-request.sequence.json'],
  ['dataflow', 'product-analytics.dataflow.json'],
  ['lifecycle', 'agent-run.lifecycle.json'],
];

// A compare artifact carries each side as an escaped srcdoc document, so its
// subresources read as `&lt;link href=&quot;https://…`. Scanning the raw text
// would report those pages as clean no matter what they link.
function unescapeEntities(html) {
  return html
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function externalSubresources(html) {
  const found = new Set();
  for (const text of [html, unescapeEntities(html)]) {
    for (const pattern of SUBRESOURCE_PATTERNS) {
      for (const [, value] of text.matchAll(pattern)) {
        if (/^https?:\/\//i.test(value) || value.startsWith('//')) found.add(value);
      }
    }
  }
  return [...found].sort();
}

function trackedViewerArtifacts() {
  const tracked = spawnSync('git', ['ls-files', '-z', '--', ...artifactRoots], {
    cwd: repoRoot,
    encoding: 'buffer',
  });
  assert.equal(tracked.status, 0, tracked.stderr.toString());
  return tracked.stdout.toString()
    .split('\0')
    .filter((entry) => entry.endsWith('.html'))
    // The reader shell, not the generator meta. `Archify.readerLayout` is the
    // code that measures font metrics to resolve the column width, so its
    // presence is exactly what makes a page sensitive to which face loaded.
    // Filtering on the meta tag instead misses the compare artifact, which
    // carries no generator meta, and would admit the site pages, which are
    // served rather than delivered and still link a stylesheet on purpose.
    .filter((entry) => /Archify\.readerLayout/
      .test(fs.readFileSync(path.join(repoRoot, entry), 'utf8')))
    .sort();
}

// One face per unicode range, each declared over the variable wght axis.
const EMBEDDED_FACE = /@font-face \{ font-family: 'JetBrains Mono'; font-style: normal; font-weight: 400 800; font-display: swap;\s*src: url\(data:font\/woff2;base64,([A-Za-z0-9+/=]+)\) format\('woff2'\);\s*unicode-range: ([^;]+); \}/g;

function embeddedFaces(html) {
  return [...html.matchAll(EMBEDDED_FACE)].map(([, base64, unicodeRange]) => ({
    bytes: Buffer.from(base64, 'base64'),
    unicodeRange: unicodeRange.trim(),
  }));
}

test('the viewer template carries its own font instead of linking a third party', () => {
  const template = fs.readFileSync(path.join(skillRoot, 'assets', 'template.html'), 'utf8');
  assert.deepEqual(externalSubresources(template), [], 'template must not reference an external origin');

  const fontLicense = fs.readFileSync(path.join(skillRoot, 'assets', 'JetBrainsMono-OFL.txt'), 'utf8');
  assert.match(fontLicense, /SIL OPEN FONT LICENSE Version 1\.1/);
  const thirdPartyNotices = fs.readFileSync(path.join(skillRoot, 'THIRD_PARTY_NOTICES.md'), 'utf8');
  assert.match(thirdPartyNotices, /## JetBrains Mono/);
  assert.match(thirdPartyNotices, /assets\/JetBrainsMono-OFL\.txt/);

  const faces = embeddedFaces(template);
  assert.ok(faces.length >= 6, `expected one embedded face per unicode range, saw ${faces.length}`);
  assert.equal(
    new Set(faces.map((face) => face.unicodeRange)).size,
    faces.length,
    'two embedded faces claim the same unicode range',
  );
  for (const { bytes } of faces) {
    assert.equal(bytes.toString('latin1', 0, 4), 'wOF2', 'an embedded face is not woff2');
  }

  // The header comment publishes a sha256 per subset so a reader can trace the
  // bytes back upstream. An unverifiable claim is worse than no claim, so the
  // digests have to match what actually ships.
  const documented = [...template.matchAll(/^\s+(\S+)\s+(\d+) bytes\s+sha256 ([0-9a-f]{64})$/gm)]
    .map(([, subset, size, sha256]) => ({ subset, size: Number(size), sha256 }));
  assert.equal(documented.length, faces.length, 'every embedded face needs a documented digest');
  const shipped = new Set(faces.map(({ bytes }) => `${bytes.length}:${createHash('sha256').update(bytes).digest('hex')}`));
  for (const { subset, size, sha256 } of documented) {
    assert.ok(shipped.has(`${size}:${sha256}`), `${subset}: no embedded face matches the documented digest`);
  }
});

test('a freshly delivered artifact of every type reaches no external origin', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-offline-'));
  try {
    for (const [type, input] of DIAGRAMS) {
      const output = path.join(dir, `${type}.html`);
      const result = spawnSync(process.execPath, [
        cli, 'deliver', type,
        path.join(skillRoot, 'examples', input),
        output,
        '--quality', 'showcase', '--json',
      ], { encoding: 'utf8' });
      assert.equal(result.status, 0, `${type}: ${result.stderr}`);
      const html = fs.readFileSync(output, 'utf8');
      assert.deepEqual(
        externalSubresources(html),
        [],
        `${type}: a self-contained page must not fetch from another origin`,
      );
      // Reaching no third party by dropping the typography would satisfy the
      // assertion above and still hand the receiver a different page.
      assert.ok(
        embeddedFaces(html).length >= 6,
        `${type}: the delivered page must carry the font it renders with`,
      );
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('every checked-in viewer artifact carries its font and reaches no external origin', () => {
  const artifacts = trackedViewerArtifacts();
  assert.ok(artifacts.length >= 20, `expected the tracked artifact set, saw ${artifacts.length}`);
  for (const relative of artifacts) {
    const html = fs.readFileSync(path.join(repoRoot, relative), 'utf8');
    assert.deepEqual(
      externalSubresources(html),
      [],
      `${relative} was generated from a template that still links an external origin — re-render it`,
    );
    // Absence of a third party is not enough: an artifact rendered before the
    // font was embedded reaches nobody and still resolves its metrics off
    // whatever the viewer's machine happens to have installed.
    assert.ok(
      embeddedFaces(html).length >= 6,
      `${relative} predates the embedded font — re-render it from the current template`,
    );
  }
});
