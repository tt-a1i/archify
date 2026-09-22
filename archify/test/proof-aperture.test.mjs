import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const landing = fs.readFileSync(path.resolve(__dirname, '..', '..', 'docs', 'index.html'), 'utf8');

function cssRule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = landing.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`));
  assert.ok(match, `${selector}: CSS rule missing`);
  return match[1];
}

test('landing declares a truthful first-fold proof aperture in document order', () => {
  assert.match(landing, /<section class="hero" data-proof-aperture="first-fold"[^>]*>/);
  const heroStart = landing.indexOf('data-proof-aperture="first-fold"');
  const headline = landing.indexOf('data-i18n="hero-h1"', heroStart);
  const actions = landing.indexOf('class="hero-actions', headline);
  const proof = landing.indexOf('id="hero-proof-stage"', actions);
  assert.ok(heroStart < headline && headline < actions && actions < proof);
});

test('desktop hero budget exposes live diagram content without shrinking its canvas', () => {
  assert.match(cssRule('.hero'), /padding-top:9rem/);
  assert.match(cssRule('.hero-bento'), /grid-template-columns:repeat\(12,1fr\)/);
  assert.match(cssRule('.hero-intro'), /grid-column:1 \/ 8/);
  assert.match(cssRule('.proof-main'), /grid-column:8 \/ 13/);
  assert.match(cssRule('.proof-main'), /grid-row:1 \/ 3/);
  assert.match(cssRule('.hero-actions .btn'), /min-height:44px/);
  assert.match(cssRule('.proof-viewport'), /min-height:430px/);
});

test('narrow viewport preserves a contained fallback without adding a mobile product surface', () => {
  const mobile = landing.match(/@media\(max-width:640px\)\s*\{([\s\S]+?)\n\s*\}\n\s*<\/style>/)?.[1];
  assert.ok(mobile, 'narrow mobile media query missing');
  assert.match(mobile, /\.hero\s*\{\s*padding-top:6\.75rem;\s*\}/);
  assert.match(mobile, /\.hero-actions \.btn\s*\{\s*flex:1;\s*justify-content:center;\s*\}/);
  assert.match(mobile, /\.proof-viewport\s*\{\s*min-height:360px;\s*\}/);
  assert.match(mobile, /\.proof-rail\s*\{\s*grid-template-columns:1fr;\s*\}/);
});

test('proof aperture remains one real eager sandboxed artifact with explicit user-selected identities', () => {
  assert.equal((landing.match(/<iframe id="hero-proof-frame"/g) || []).length, 1);
  assert.match(landing, /loading="eager"/);
  assert.match(landing, /sandbox="allow-scripts"/);
  assert.doesNotMatch(landing, /sandbox="[^"]*allow-same-origin/);
  assert.equal((landing.match(/class="spec-card(?: [^"]*)?"/g) || []).length, 3);
  assert.match(landing, /data-proof-playback="first-fold-once"/);
  assert.match(landing, /\?embed=1&amp;play=1&amp;theme=dark#view=happy-path/);
  assert.doesNotMatch(landing, /setInterval\(|scrollIntoView\(|scroll-triggered|proof-carousel/);
});

test('initial proof playback uses one sandboxed load without parent-frame reach-through', () => {
  assert.match(landing, /src="gallery\/artifacts\/agent-tool-call\.workflow\.html\?embed=1&amp;play=1&amp;theme=dark#view=happy-path"/);
  assert.doesNotMatch(landing, /initialProof|proofFrameDocumentIsReady|proofFrame\.contentWindow|proofFrame\.contentDocument/);
  assert.match(landing, /proofFrame\.addEventListener\('load', \(\) => \{/);
  assert.match(landing, /proofStage\.classList\.remove\('is-loading'\)/);
});

test('proof playback delegates reduced motion to the artifact and keeps deliberate-choice boundaries', () => {
  assert.match(landing, /renderProof\(tab\.dataset\.proof, \{ deliberate: true \}\)/);
  assert.match(landing, /renderProof\(tabs\[next\]\.dataset\.proof, \{ focus: true, deliberate: true \}\)/);
  assert.match(landing, /proofEmbedUrl\(proof, \{ play: deliberate \}\)/);
  // Shared page polish may track scroll; hero proof playback must remain deliberate.
  const proofScript = landing.slice(landing.indexOf('const PROOFS ='), landing.indexOf('const typeChapters ='));
  assert.ok(proofScript.includes('function renderProof('));
  assert.doesNotMatch(proofScript, /addEventListener\('scroll'/);
});

test('aperture uses normal flow and preserves reduced-motion boundaries', () => {
  const hero = cssRule('.hero');
  const proof = cssRule('.proof-main');
  assert.doesNotMatch(hero + proof, /position:absolute|transform:|top:-|margin-top:-|height:100vh/);
  assert.match(landing, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(landing, /\.fade-up\s*\{\s*opacity:1!important;\s*transform:none!important;/);
  assert.match(landing, /\.pulse-dot,\.proof-live::before\s*\{\s*animation:none!important;\s*\}/);
});
