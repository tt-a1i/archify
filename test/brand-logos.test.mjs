import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { BRAND_LOGOS } from '../archify/renderers/shared/generated-brand-logos.mjs';
import { BRAND_MARKS } from '../archify/renderers/shared/generated-brand-marks.mjs';
import { logoBodyProblems, sanitizeLogoSvg } from '../archify/scripts/brand-logo-sanitize.mjs';
import { GENERIC_ICONS, genericIconFor } from '../archify/renderers/architecture/generic-icons.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'archify');
const cli = path.join(skillRoot, 'bin', 'archify.mjs');
const manifest = JSON.parse(fs.readFileSync(path.join(skillRoot, 'brand-marks', 'logos.json'), 'utf8'));

function render(t, components, meta = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-logos-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const input = path.join(dir, 'in.json');
  const output = path.join(dir, 'out.html');
  fs.writeFileSync(input, JSON.stringify({ schema_version: 1, diagram_type: 'architecture', meta: { title: 'Logos', output: 'out.html', ...meta }, components, connections: [] }));
  const result = spawnSync(process.execPath, [cli, 'render', 'architecture', input, output], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return fs.readFileSync(output, 'utf8');
}

test('the logo sanitizer strips scripts, handlers, styles and external references', () => {
  const hostile = `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 24 24" onload="alert(1)">
  <script>alert(2)</script><style>@import url(https://evil.example/x.css);</style>
  <foreignObject><iframe src="https://evil.example"/></foreignObject>
  <image href="https://evil.example/p.png" width="5" height="5"/>
  <a href="javascript:alert(3)"><path d="M0 0h1"/></a>
  <defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/></linearGradient></defs>
  <use xlink:href="https://evil.example/s.svg#a"/>
  <path d="M1 1h22v22H1z" fill="url(#g)" onclick="alert(4)" style="fill:url(https://evil.example/#a)"/>
  <rect width="4" height="4" fill="url(https://evil.example/#b)" filter="url(#missing)"/>
</svg>`;
  const { body, viewBox } = sanitizeLogoSvg(hostile, 'al-test');
  assert.deepEqual(viewBox, [0, 0, 24, 24]);
  for (const bad of [/<script/i, /<style/i, /foreignObject/i, /<image/i, /<iframe/i, /<a[\s>]/i, /\son\w+=/i,
    /javascript:/i, /https?:/i, /ENTITY/, /passwd/, /style=/i]) {
    assert.doesNotMatch(body, bad);
  }
  assert.match(body, /id="al-test-0"/, 'local ids are namespaced');
  assert.match(body, /fill="url\(#al-test-0\)"/, 'local references follow the namespace');
  assert.deepEqual(logoBodyProblems(body), []);
  assert.ok(logoBodyProblems('<path onload="x" d="M0 0"/>').length > 0, 'post-check rejects handlers');
  assert.ok(logoBodyProblems('<use href="https://evil.example/#a"/>').length > 0, 'post-check rejects external refs');
});

test('every embedded logo is safe and carries complete provenance', () => {
  assert.ok(BRAND_LOGOS.length >= 200, `logo count ${BRAND_LOGOS.length}`);
  assert.equal(BRAND_LOGOS.length, manifest.logos.length);
  const marks = new Set(BRAND_MARKS.map((mark) => mark.id));
  const ids = new Set();
  for (const logo of BRAND_LOGOS) {
    assert.ok(!ids.has(logo.id), `duplicate ${logo.id}`);
    ids.add(logo.id);
    assert.ok(marks.has(logo.id), `${logo.id} matches a brand key`);
    assert.deepEqual(logoBodyProblems(logo.body), [], logo.id);
    const ownIds = [...logo.body.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    for (const id of ownIds) assert.ok(id.startsWith(`al-${logo.id}-`), `${logo.id} id ${id} is namespaced`);
    assert.equal(logo.viewBox.length, 4);
    const p = logo.provenance;
    const provider = Object.values(manifest.providers).find((entry) => entry.name === p.provider);
    assert.ok(provider, `${logo.id} provider`);
    assert.equal(p.license, provider.license, `${logo.id} license`);
    assert.ok(['CC0-1.0', 'MIT'].includes(p.license), `${logo.id} license ${p.license}`);
    assert.equal(p.commit, provider.commit, `${logo.id} pinned commit`);
    assert.equal(p.repository, provider.repository, `${logo.id} repository`);
    assert.match(p.commit, /^[0-9a-f]{40}$/);
    assert.match(p.sha256, /^[0-9a-f]{64}$/, `${logo.id} sha256`);
    assert.ok(p.file && p.url.includes(p.commit) && p.url.endsWith(p.file), `${logo.id} url`);
  }
  for (const mark of BRAND_MARKS.filter((m) => m.path === null)) assert.ok(ids.has(mark.id), `${mark.id} logo-only`);
  assert.ok(fs.existsSync(path.join(skillRoot, 'third_party', 'devicon', 'LICENSE')));
  assert.match(fs.readFileSync(path.join(skillRoot, 'THIRD_PARTY_NOTICES.md'), 'utf8'), /Logos are trademarks of their respective owners\./);
});

test('a diagram embeds only the logos it uses, unrecoloured', (t) => {
  const html = render(t, [
    { id: 'web', type: 'frontend', label: 'Web', brand: 'next-js', pos: [40, 40] },
    { id: 'db', type: 'database', label: 'Primary DB', brand: 'postgresql', pos: [240, 40] },
    { id: 'pay', type: 'external', label: 'Payments', pos: [440, 40] },
  ]);
  const used = [...html.matchAll(/data-brand-mark="([^"]+)"[^>]*data-brand-logo="/g)].map((m) => m[1]).sort();
  assert.deepEqual(used, ['next-js', 'postgresql']);
  const prefixes = new Set([...html.matchAll(/\sid="al-([a-z0-9-]+?)-\d+"/g)].map((m) => m[1]));
  for (const prefix of prefixes) assert.ok(['next-js', 'postgresql'].includes(prefix), `unexpected logo ids ${prefix}`);
  const pg = BRAND_LOGOS.find((logo) => logo.id === 'postgresql');
  assert.ok(html.includes(pg.body.replace(/<(\/?)defs(?=[\s>/])/g, '<$1g')), 'logo body is embedded verbatim (no recolouring)');
  assert.equal(html.match(/<symbol id="al-sym-postgresql"/g).length, 1, 'each used logo is embedded once');
  const unused = BRAND_LOGOS.find((logo) => logo.id === 'kubernetes');
  assert.ok(!html.includes(unused.body.slice(0, 80)), 'unused logos stay out of the output');
  assert.ok(!html.includes('BRAND_LOGOS'), 'the logo catalog is not shipped');
});

test('unbranded nodes fall back to a generic icon picked from their type and name', (t) => {
  assert.equal(Object.keys(GENERIC_ICONS).length, 24);
  assert.equal(genericIconFor({ type: 'database', label: 'Orders' }), 'database');
  assert.equal(genericIconFor({ type: 'backend', label: 'Redis cache' }), 'cache');
  assert.equal(genericIconFor({ type: 'messagebus', label: '消息队列' }), 'queue');
  assert.equal(genericIconFor({ type: 'frontend', label: 'Users' }), 'user');
  assert.equal(genericIconFor({ type: 'backend', label: 'Orders', icon: 'calendar' }), 'scheduler');
  assert.equal(genericIconFor({ type: 'unknown-kind', label: 'Thing' }), 'service');
  for (const name of Object.keys(GENERIC_ICONS)) assert.deepEqual(logoBodyProblems(GENERIC_ICONS[name]), [], name);
  const html = render(t, [
    { id: 'db', type: 'database', label: 'Orders DB', pos: [40, 40] },
    { id: 'plain', type: 'backend', label: 'Plain', icon: 'none', pos: [240, 40] },
  ]);
  assert.match(html, /data-node-id="db"[\s\S]*?class="node-card-tile"\/>\s*<use aria-hidden="true" class="generic-icon gi-database" data-generic-icon="database"/);
  const plain = html.slice(html.indexOf('data-node-id="plain"'));
  assert.doesNotMatch(plain.slice(0, plain.indexOf('</g>\n        </g>') + 1), /data-generic-icon/, 'icon: none hides the generic icon');
});

test('dark theme keeps logos on a light plate and tints generic icons from theme strokes', (t) => {
  const html = render(t, [
    { id: 'gh', type: 'external', label: 'GitHub', brand: 'github', pos: [40, 40] },
    { id: 'q', type: 'messagebus', label: 'Order queue', pos: [240, 40] },
  ]);
  assert.match(html, /\[data-theme="dark"\][^{]*\[data-node-card\] > rect\.node-card\.node-card \{ fill:/);
  assert.match(html, /\[data-node-card\] > \.brand-mark \.brand-mark-badge \{ fill: #f6f8fb; \}/, 'logo plate stays light in dark');
  assert.match(html, /\.generic-icon \{ fill: none; stroke: color-mix\(in srgb, var\(--text\) 78%, var\(--mask\)\)/);
  assert.match(html, /\.generic-icon\.gi-messagebus \{ --gi-fill: color-mix\(in srgb, var\(--messagebus-stroke\) 22%, transparent\); \}/);
  assert.match(html, /<symbol id="gi-queue" viewBox="0 0 24 24"/);
  assert.match(html, /<symbol id="al-sym-github"/);
});
