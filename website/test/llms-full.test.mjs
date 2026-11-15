import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const websiteRoot = fileURLToPath(new URL('../', import.meta.url));
const repoRoot = path.resolve(websiteRoot, '..');
const templatePath = path.join(websiteRoot, 'src/data/llms-full.txt');
const output = path.resolve(websiteRoot, process.env.ARCHIFY_SITE_ROOT
  || (process.env.ARCHIFY_SITE_TARGET === 'cloudflare' ? 'dist-cloudflare' : 'dist'));
const read = relative => fs.readFileSync(path.join(repoRoot, relative), 'utf8');
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('llms-full.txt derives release identity from package metadata and covers capabilities, boundaries, and disambiguation', () => {
  const release = JSON.parse(read('archify/skill-release.json'));
  const packageJson = JSON.parse(read('archify/package.json'));
  assert.equal(packageJson.version, release.version, 'release metadata must agree on one version');
  const template = fs.readFileSync(templatePath, 'utf8');
  assert.match(template, /^> Version: \[\[ARCHIFY_VERSION\]\]$/m);
  assert.match(template, /^> Release channel: \[\[ARCHIFY_CHANNEL\]\]$/m);

  const built = path.join(output, 'llms-full.txt');
  assert.ok(fs.existsSync(built), 'the build must publish /llms-full.txt');
  const text = fs.readFileSync(built, 'utf8');
  assert.doesNotMatch(text, /\[\[ARCHIFY_/, 'all template placeholders must be resolved');
  assert.match(text, new RegExp(`^> Version: ${escape(release.version)}$`, 'm'));
  assert.match(text, new RegExp(`^> Release channel: ${escape(release.channel)}$`, 'm'));
  assert.match(text, /https:\/\/archify\.si\/llms\.txt/);
  assert.match(text, /Apache-2\.0/);
  assert.match(text, /Salah-XD\/archify/);
  assert.match(text, /not\b[\s\S]{0,80}browser extension/i);
  for (const type of ['architecture', 'workflow', 'sequence', 'dataflow', 'lifecycle', 'erd', 'class', 'tree', 'timeline', 'waterfall']) {
    assert.match(text, new RegExp(`\`${type}\``), `missing diagram type: ${type}`);
  }
  for (const tool of ['Mermaid', 'Excalidraw', 'PlantUML', 'D2']) assert.ok(text.includes(tool), tool);
  assert.match(text, /one-page (answer|explainer)/i);
  assert.match(text, /does not prove/i);
  assert.doesNotMatch(text, /aggregateRating|reviewCount|ratingValue/, 'no invented rating signals');
});

test('every canonical site link in built llms-full.txt is extensionless HTML or a real static endpoint', () => {
  const text = fs.readFileSync(path.join(output, 'llms-full.txt'), 'utf8');
  const links = [...new Set([...text.matchAll(/https:\/\/archify\.si[^\s)`<>]*/g)].map(match => match[0]))];
  assert.ok(links.length >= 10, `expected a canonical link index, got ${links.length}`);
  for (const link of links) {
    const url = new URL(link);
    assert.doesNotMatch(url.pathname, /\.html$/, `canonical link must omit .html: ${link}`);
    const relative = decodeURIComponent(url.pathname).replace(/^\//, '') || 'index.html';
    const target = path.resolve(output, relative);
    assert.ok(target.startsWith(`${output}${path.sep}`), `link escapes output: ${link}`);
    const candidates = [target, `${target}.html`, path.join(target, 'index.html')];
    assert.ok(candidates.some(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile()), `canonical link has no built artifact: ${link}`);
  }
});
