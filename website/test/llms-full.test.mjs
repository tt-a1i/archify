import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const websiteRoot = fileURLToPath(new URL('../', import.meta.url));
const repoRoot = path.resolve(websiteRoot, '..');
const source = path.join(repoRoot, 'website/public/llms-full.txt');
const output = path.resolve(websiteRoot, process.env.ARCHIFY_SITE_ROOT
  || (process.env.ARCHIFY_SITE_TARGET === 'cloudflare' ? 'dist-cloudflare' : 'dist'));
const read = relative => fs.readFileSync(path.join(repoRoot, relative), 'utf8');
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('llms-full.txt is version-synced and covers capabilities, boundaries, and disambiguation', () => {
  const release = JSON.parse(read('archify/skill-release.json'));
  const packageJson = JSON.parse(read('archify/package.json'));
  assert.equal(packageJson.version, release.version, 'release metadata must agree on one version');
  const text = fs.readFileSync(source, 'utf8');
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

test('built llms-full.txt is the published source and every canonical site link resolves in the output', () => {
  const sourceText = fs.readFileSync(source, 'utf8');
  const built = path.join(output, 'llms-full.txt');
  assert.ok(fs.existsSync(built), 'the build must publish /llms-full.txt');
  assert.equal(fs.readFileSync(built, 'utf8'), sourceText);
  const links = [...new Set([...sourceText.matchAll(/https:\/\/archify\.si\/[^\s)`<>]*/g)].map(match => match[0]))];
  assert.ok(links.length >= 10, `expected a canonical link index, got ${links.length}`);
  for (const link of links) {
    const url = new URL(link);
    let relative = decodeURIComponent(url.pathname);
    if (!relative || relative.endsWith('/')) relative += 'index.html';
    else if (!path.extname(relative)) relative += '.html';
    const file = path.resolve(output, relative.replace(/^\//, ''));
    assert.ok(file.startsWith(`${output}${path.sep}`), `link escapes output: ${link}`);
    assert.ok(fs.existsSync(file) && fs.statSync(file).isFile(), `canonical link has no built artifact: ${link}`);
  }
});
