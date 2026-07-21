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
  assert.match(landing, /<section class="hero" data-proof-aperture="first-fold">/);
  const heroStart = landing.indexOf('data-proof-aperture="first-fold"');
  const headline = landing.indexOf('data-i18n="hero-h1"', heroStart);
  const actions = landing.indexOf('class="hero-actions', headline);
  const proof = landing.indexOf('id="hero-proof-stage"', actions);
  assert.ok(heroStart < headline && headline < actions && actions < proof);
});

test('desktop hero budget exposes live diagram content without shrinking its canvas', () => {
  assert.match(cssRule('.hero'), /padding-top:5\.5rem/);
  assert.match(cssRule('.hero-badge'), /margin-bottom:1\.125rem/);
  assert.match(cssRule('.hero h1'), /margin-bottom:\.875rem/);
  assert.match(cssRule('.hero-sub'), /margin:0 auto 1\.375rem/);
  assert.match(cssRule('.hero-actions'), /margin-bottom:1\.5rem/);
  assert.match(cssRule('.hero-actions .btn'), /min-height:44px/);
  assert.match(cssRule('.proof-viewport'), /height:clamp\(500px,52vw,610px\)/);
});

test('narrow mobile gets an independently tuned proof aperture and full-size actions', () => {
  const mobile = landing.match(/@media\(max-width:640px\)\s*\{([\s\S]+?)\n\s*\}\n\s*<\/style>/)?.[1];
  assert.ok(mobile, 'narrow mobile media query missing');
  assert.match(mobile, /\.hero\s*\{\s*padding-top:4\.75rem;\s*\}/);
  assert.match(mobile, /\.hero-actions\s*\{\s*flex-direction:column;\s*gap:\.625rem;\s*\}/);
  assert.match(mobile, /\.hero-actions \.btn\s*\{\s*width:100%;\s*justify-content:center;\s*\}/);
  assert.match(mobile, /\.proof-viewport\s*\{\s*height:400px;\s*\}/);
});

test('proof aperture remains one real eager artifact with explicit user-selected identities', () => {
  assert.equal((landing.match(/<iframe id="hero-proof-frame"/g) || []).length, 1);
  assert.match(landing, /loading="eager"/);
  assert.equal((landing.match(/class="proof-tab"/g) || []).length, 3);
  assert.match(landing, /data-proof-playback="settled"/);
  assert.match(landing, /\?embed=1&amp;theme=dark#view=happy-path/);
  assert.doesNotMatch(landing, /src="[^"]+play=1[^"]+"/);
  assert.doesNotMatch(landing, /setInterval\(|scrollIntoView\(|scroll-triggered|proof-carousel/);
});

test('initial proof playback waits for 88 visible canvas pixels and can start only once', () => {
  assert.match(landing, /let initialProofPlaybackStarted = false/);
  assert.match(landing, /visibleHeight < 88/);
  assert.match(landing, /new IntersectionObserver\(entries =>/);
  assert.match(landing, /threshold: \[0, \.15, \.2\]/);
  assert.match(landing, /if \(initialProofPlaybackStarted \|\| proofMotionPreference\.matches \|\| activeProof !== 'signal'\) return false/);
  assert.match(landing, /initialProofPlaybackStarted = true/);
  assert.match(landing, /proofStage\.dataset\.proofPlayback = 'visible-once'/);
  assert.match(landing, /initialProofObserver\.disconnect\(\)/);
});

test('proof visibility handshake has reduced-motion, no-observer, and deliberate-choice boundaries', () => {
  assert.match(landing, /window\.matchMedia\('\(prefers-reduced-motion: reduce\)'\)/);
  assert.match(landing, /if \(proofMotionPreference\.matches \|\| !\('IntersectionObserver' in window\)\) return/);
  assert.match(landing, /renderProof\(tab\.dataset\.proof, \{ deliberate: true \}\)/);
  assert.match(landing, /renderProof\(tabs\[next\]\.dataset\.proof, \{ focus: true, deliberate: true \}\)/);
  assert.match(landing, /proofEmbedUrl\(proof, \{ play: deliberate \}\)/);
  assert.match(landing, /document\.querySelectorAll\('\.fade-up'\)\.forEach\(el => el\.classList\.add\('visible'\)\)/);
  assert.doesNotMatch(landing, /addEventListener\('scroll'/);
});

test('aperture uses normal flow and preserves reduced-motion boundaries', () => {
  const hero = cssRule('.hero');
  const proof = cssRule('.hero-proof');
  assert.doesNotMatch(hero + proof, /position:absolute|transform:|top:-|margin-top:-|height:100vh/);
  assert.match(landing, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(landing, /\.fade-up\s*\{\s*opacity:1!important;\s*transform:none!important;/);
  assert.match(landing, /\.pulse-dot,\.proof-live::before\s*\{\s*animation:none!important;\s*\}/);
});
