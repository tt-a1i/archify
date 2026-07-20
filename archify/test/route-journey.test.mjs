import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const template = fs.readFileSync(path.join(skillRoot, 'assets', 'template.html'), 'utf8');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-route-journey-'));

const CASES = {
  architecture: 'web-app.architecture.json',
  workflow: 'agent-tool-call.workflow.json',
  sequence: 'cache-miss-request.sequence.json',
  dataflow: 'product-analytics.dataflow.json',
  lifecycle: 'agent-run.lifecycle.json',
};

function render(mode, example) {
  const input = path.join(skillRoot, 'examples', example);
  const output = path.join(tmp, `${mode}.html`);
  const result = spawnSync(process.execPath, [
    path.join(skillRoot, `renderers/${mode}/render-${mode}.mjs`),
    input,
    output,
  ], { encoding: 'utf8' });
  return { result, html: fs.existsSync(output) ? fs.readFileSync(output, 'utf8') : '' };
}

function canonicalSvg(html) {
  return html.match(/<svg\b[\s\S]*?<\/svg>/)?.[0] || '';
}

test('all five renderers inherit native Route Journey controls outside canonical SVG', () => {
  for (const [mode, example] of Object.entries(CASES)) {
    const { result, html } = render(mode, example);
    assert.equal(result.status, 0, result.stderr);
    assert.match(html, /id="route-journey-controls" hidden role="group" aria-label="Route journey controls"/i, mode);
    assert.match(html, /id="route-journey-prev"[^>]+aria-label="Previous route position"/i, mode);
    assert.match(html, /id="route-journey-play"[^>]+aria-label="Play route journey"[^>]+aria-pressed="false"/i, mode);
    assert.match(html, /id="route-journey-next"[^>]+aria-label="Next route position"/i, mode);
    assert.match(html, /id="route-journey-overview"[^>]+aria-label="Show complete route overview"/i, mode);
    assert.match(html, /document\.createElement\(options\.interactive === true \? 'button' : 'span'\)/, mode);
    assert.doesNotMatch(canonicalSvg(html), /data-route-journey|route-journey-(?:flow|overlay)/, mode);
  }
});

test('a position owns its exact ordered incoming edge while the full route remains authored truth', () => {
  assert.match(template, /activeNodeIds = result\.nodes\.slice\(\)/);
  assert.match(template, /activeEdges = result\.edges\.slice\(\)/);
  assert.match(template, /activeEdges\.forEach\(function \(edge, step\) \{[\s\S]*?var destination = step \+ 1/);
  assert.match(template, /destination === journeyIndex \? 'current' : 'future'/);
  assert.match(template, /edge\.setAttribute\('data-route-journey-current', ''\)/);
  assert.match(template, /journeyIndex > 0\) renderJourneyPulse\(activeEdges\[journeyIndex - 1\]\)/);
  assert.match(template, /node\.setAttribute\('data-route-match', ''\)/);
  assert.match(template, /edge\.setAttribute\('data-route-match', ''\)/);
  assert.match(template, /svg\.setAttribute\('data-route-journey', \(journeyIndex \+ 1\) \+ '\/' \+ activeNodeIds\.length\)/);
  assert.doesNotMatch(template, /renderJourneyPulse\([\s\S]{0,120}querySelector\(.*data-edge-from/);
});

test('route chips provide one roving tab stop, native activation, and manual ownership', () => {
  assert.match(template, /item\.setAttribute\('data-route-journey-index', String\(index\)\)/);
  assert.match(template, /item\.setAttribute\('tabindex', index === 0 \? '0' : '-1'\)/);
  assert.match(template, /item\.setAttribute\('aria-label', 'Route position ' \+ \(index \+ 1\) \+ ' of ' \+ ids\.length/);
  assert.match(template, /path\.addEventListener\('focusin'[\s\S]*?pauseJourney\(\{ preserveElapsed: true \}\)/);
  assert.match(template, /path\.addEventListener\('keydown'[\s\S]*?event\.key === 'ArrowRight'/);
  assert.match(template, /else if \(event\.key === 'Home'\) next = 0/);
  assert.match(template, /else if \(event\.key === 'End'\) next = activeNodeIds\.length - 1/);
  assert.match(template, /event\.key === 'Enter' \|\| event\.key === ' '/);
  assert.match(template, /selectJourneyIndex\(Number\(button\.getAttribute\('data-route-journey-index'\)\)\)/);
  assert.match(template, /button\.setAttribute\('aria-current', 'step'\)/);
});

test('playback is explicit, finite, resumable, and never leaks position into the route URL', () => {
  assert.match(template, /var JOURNEY_DWELL_MS = 1100/);
  assert.match(template, /journeyGeneration \+= 1/);
  assert.match(template, /generation !== journeyGeneration \|\| !journeyPlaying/);
  assert.match(template, /JOURNEY_DWELL_MS - journeyElapsedMs/);
  assert.match(template, /preserveElapsed: options\.complete !== true/);
  assert.match(template, /journeyIndex >= activeNodeIds\.length - 1[\s\S]*?pauseJourney\(\{ complete: true/);
  assert.match(template, /applyJourneyState\(journeyIndex \+ 1[\s\S]*?journeyElapsedMs = 0;[\s\S]*?scheduleJourney\(\)/);
  assert.doesNotMatch(template, /journeyTimer\s*=\s*(?:window\.)?setInterval/);
  assert.match(template, /function playJourney\(\)[\s\S]*?if \(journeyIndex < 0\) applyJourneyState\(0/);
  assert.match(template, /function syncFromHash\(\)[\s\S]*?choose\(parts\[1\], \{ updateUrl: false \}\)/);
  assert.match(template, /'#route=' \+ encodeURIComponent\(startId\) \+ '~' \+ encodeURIComponent\(endId\)/);
  assert.doesNotMatch(template, /#route=[^'\n]*journey/);
});

test('motion, camera, layered Escape, mobile, print, and embed boundaries stay explicit', () => {
  assert.match(template, /Archify\.motionGovernor\.capable === true[\s\S]*?!Archify\.motionGovernor\.isPaused\(\)/);
  assert.match(template, /Archify\.motionGovernor\.claim\('route'/);
  assert.match(template, /reason: 'route-journey',[\s\S]*?maxScale: 1\.65,[\s\S]*?padding: 64,[\s\S]*?duration: 360/);
  assert.match(template, /Archify\.routeProbe\.pauseJourney\(\{ preserveElapsed: true, reason: reason \|\| 'manual' \}\)/);
  assert.match(template, /event\.target\.closest\('\.diagram-nav, \.focus-chip, \.node-finder, \.diagram-guide, \.overview-map, \.route-probe, \.semantic-lens'\)/);
  assert.match(template, /reason: 'guide'/);
  assert.match(template, /window\.addEventListener\('beforeprint'[\s\S]*?pauseJourney/);
  assert.match(template, /function escapeRoute\(options\)[\s\S]*?return 'paused'[\s\S]*?return 'overview'[\s\S]*?return 'cleared'/);
  assert.match(template, /Archify\.routeProbe\.escape\(\{ restoreFocus: true \}\)/);
  assert.match(template, /\.route-probe\[data-route-dock="top"\] \{\s*top: 1rem;\s*bottom: auto;/);
  assert.match(template, /function updateDocking\(\) \{\s*if \(panel\.hidden\)/);
  assert.doesNotMatch(template, /if \(panel\.hidden \|\| window\.innerWidth > 720\)/);
  assert.match(template, /@media \(max-width: 720px\)[\s\S]*?\.route-probe-node \{ min-height: 2\.75rem !important; \}/);
  assert.match(template, /\.route-journey-controls button \{ min-height: 2\.75rem; \}/);
  assert.match(template, /@media print[\s\S]*?\.route-probe-overlay, \.route-journey-overlay \{ display: none !important; \}/);
  assert.match(template, /svg\[data-route-active\] \[data-node-id\],[\s\S]*?filter: none !important/);
  assert.match(template, /html\[data-embed="true"\][\s\S]*?\.route-probe/);
  assert.match(template, /html\[data-motion="still"\] \.route-journey-flow/);
  assert.match(template, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.route-journey-overlay/);
});

test('standalone export strips every journey attribute and transient pulse', () => {
  assert.match(template, /clone\.removeAttribute\('data-route-journey'\)/);
  assert.match(template, /clone\.querySelectorAll\('\[data-route-journey-overlay\]'\)/);
  assert.match(template, /el\.removeAttribute\('data-route-journey-state'\)/);
  assert.match(template, /el\.removeAttribute\('data-route-journey-current'\)/);
  assert.match(template, /!clone\.hasAttribute\('data-route-journey'\)/);
  assert.match(template, /canonicalStateClean[\s\S]*?\[data-route-journey-overlay\][\s\S]*?\[data-route-journey-current\]/);
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
