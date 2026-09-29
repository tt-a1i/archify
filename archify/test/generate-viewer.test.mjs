import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const marker = '/* ARCHIFY:READER_LAYOUT */';
const viewerCssMarker = '/* ARCHIFY:VIEWER_CSS */';
const exportMarker = '/* ARCHIFY:EXPORT */';
const cleanupMarker = '/* ARCHIFY:EXPORT_CLEANUP */';
const chromeMarker = '/* ARCHIFY:CHROME_LAYOUT */';
const cameraMarker = '/* ARCHIFY:CAMERA */';
const radarMarker = '/* ARCHIFY:RADAR */';
const motionMarker = '/* ARCHIFY:MOTION_GOVERNOR */';
const finderMarker = '/* ARCHIFY:NODE_FINDER */';
const outlineMarker = '/* ARCHIFY:NODE_OUTLINE */';
const intentMarker = '/* ARCHIFY:INTENT_TRACE */';
const lensMarker = '/* ARCHIFY:SEMANTIC_LENS */';
const routeMarker = '/* ARCHIFY:ROUTE_PROBE */';
const focusMarker = '/* ARCHIFY:FOCUS */';
const fragments = { viewerCss: viewerCssMarker, export: exportMarker, reader: marker, cleanup: cleanupMarker, chrome: chromeMarker, camera: cameraMarker, radar: radarMarker, motion: motionMarker, finder: finderMarker, outline: outlineMarker, intent: intentMarker, lens: lensMarker, route: routeMarker, focus: focusMarker };

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-viewer-build-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.mkdirSync(path.join(root, 'archify/assets'), { recursive: true });
  fs.cpSync(path.join(repoRoot, 'viewer'), path.join(root, 'viewer'), { recursive: true });
  fs.copyFileSync(path.join(repoRoot, 'scripts/generate-viewer.mjs'), path.join(root, 'scripts/generate-viewer.mjs'));
  fs.symlinkSync(path.join(repoRoot, 'archify/node_modules'), path.join(root, 'archify/node_modules'), 'junction');
  const output = path.join(root, 'archify/assets/template.html');
  fs.copyFileSync(path.join(repoRoot, 'archify/assets/template.html'), output);
  return {
    root, output,
    shell: path.join(root, 'viewer/template.source.html'),
    viewerCss: path.join(root, 'viewer/viewer.css'),
    export: path.join(root, 'viewer/export.js'),
    reader: path.join(root, 'viewer/reader-layout.js'),
    cleanup: path.join(root, 'viewer/export-cleanup.js'),
    chrome: path.join(root, 'viewer/viewer-chrome-layout.js'),
    camera: path.join(root, 'viewer/viewer-camera.js'),
    radar: path.join(root, 'viewer/semantic-radar.js'),
    motion: path.join(root, 'viewer/motion-governor.js'),
    finder: path.join(root, 'viewer/node-finder.js'),
    outline: path.join(root, 'viewer/node-outline.js'),
    intent: path.join(root, 'viewer/intent-trace.js'),
    lens: path.join(root, 'viewer/semantic-lens.js'),
    route: path.join(root, 'viewer/route-probe.js'),
    focus: path.join(root, 'viewer/focus.js'),
    run: (...args) => spawnSync(process.execPath, [path.join(root, 'scripts/generate-viewer.mjs'), ...args], {
      cwd: os.tmpdir(), encoding: 'utf8',
    }),
  };
}

test('the committed Viewer rebuilds deterministically outside the repository working directory', (t) => {
  const f = fixture(t);
  const baseline = fs.readFileSync(f.output);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const generated = f.run();
    assert.equal(generated.status, 0, generated.stderr);
    assert.deepEqual(fs.readFileSync(f.output), baseline);
  }
  const beforeCheck = fs.statSync(f.output).mtimeMs;
  const checked = f.run('--check');
  assert.equal(checked.status, 0, checked.stderr);
  assert.equal(fs.statSync(f.output).mtimeMs, beforeCheck, '--check must not rewrite output');
});

test('editing any authoritative source requires explicit regeneration', (t) => {
  const f = fixture(t);
  for (const input of [f.shell, f.viewerCss, f.export, f.reader, f.cleanup, f.chrome, f.camera, f.radar, f.motion, f.finder, f.outline, f.intent, f.lens, f.route, f.focus]) {
    const previous = fs.readFileSync(f.output);
    fs.writeFileSync(input, (input === f.viewerCss ? ':root { --source-change: 1; }\n' : input === f.shell ? '<!-- source change -->\n' : 'globalThis.__sourceChange = 1;\n') + fs.readFileSync(input, 'utf8'));
    const stale = f.run('--check');
    assert.equal(stale.status, 1);
    assert.match(stale.stderr, /stale.*generate:viewer/);
    assert.deepEqual(fs.readFileSync(f.output), previous);
    assert.equal(f.run().status, 0);
    assert.equal(f.run('--check').status, 0);
    assert.notDeepEqual(fs.readFileSync(f.output), previous);
  }
});

test('a missing generated template is stale and can be regenerated', (t) => {
  const f = fixture(t);
  fs.unlinkSync(f.output);
  assert.equal(f.run('--check').status, 1);
  assert.equal(fs.existsSync(f.output), false);
  assert.equal(f.run().status, 0);
  assert.equal(f.run('--check').status, 0);
});

test('viewer.css owns the complete main style block', (t) => {
  const f = fixture(t);
  const shell = fs.readFileSync(f.shell, 'utf8');
  const markerIndex = shell.indexOf(viewerCssMarker);
  assert.notEqual(markerIndex, -1);
  const afterMarker = shell.slice(markerIndex + viewerCssMarker.length);
  assert.match(afterMarker, /^\n\s*<\/style>/);
  const css = fs.readFileSync(f.viewerCss, 'utf8');
  assert.match(css, /@media print \{/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{/);
  assert.match(css, /\n\}\n$/);
});

for (const [fragment, slot] of Object.entries(fragments)) {
  for (const failure of ['missing shell', 'missing fragment', 'missing marker', 'duplicate marker', 'empty fragment', ...Object.keys(fragments).map(name => `${name} marker`)]) {
    test(`assembly rejects ${fragment}: ${failure} without overwriting a valid artifact`, (t) => {
      const f = fixture(t);
      const previous = fs.readFileSync(f.output);
      if (failure === 'missing shell') fs.unlinkSync(f.shell);
      if (failure === 'missing fragment') fs.unlinkSync(f[fragment]);
      const owner = fragment === 'cleanup' ? f.export : f.shell;
      if (failure === 'missing marker') fs.writeFileSync(owner, fs.readFileSync(owner, 'utf8').replace(slot, ''));
      if (failure === 'duplicate marker') fs.appendFileSync(owner, slot);
      if (failure === 'empty fragment') fs.writeFileSync(f[fragment], ' \n');
      const embeddedSlot = fragments[failure.replace(/ marker$/, '')];
      if (embeddedSlot) fs.appendFileSync(f[fragment], embeddedSlot);
      for (const args of [[], ['--check']]) {
        const result = f.run(...args);
        assert.equal(result.status, 1, failure);
        assert.match(result.stderr, /ENOENT|marker|empty/);
        assert.deepEqual(fs.readFileSync(f.output), previous);
        assert.deepEqual(fs.readdirSync(path.dirname(f.output)), ['template.html']);
      }
    });
  }
}

test('compilation preserves literal replacement tokens and Unicode across fragments', (t) => {
  const f = fixture(t);
  const literal = '$& $\' $` $$ 中文 🗺';
  const reader = `globalThis.values.push(${JSON.stringify(literal)});\r\n`;
  const css = '/* ordinary build comment */\r\n:root { --x: 1; }\r\n';
  fs.writeFileSync(f.shell, `<style>${viewerCssMarker}</style><script>\r\n${focusMarker}${routeMarker}${lensMarker}${intentMarker}${finderMarker}${outlineMarker}${motionMarker}${radarMarker}${cameraMarker}${chromeMarker}${exportMarker}${marker}</script>\n`);
  fs.writeFileSync(f.viewerCss, css);
  for (const file of [f.reader, f.cleanup, f.chrome, f.camera, f.radar, f.motion, f.finder, f.intent, f.lens, f.route, f.outline, f.focus]) fs.writeFileSync(file, reader);
  fs.writeFileSync(f.export, reader + cleanupMarker);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  const html = fs.readFileSync(f.output, 'utf8');
  const values = [];
  vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], { values });
  assert.deepEqual(values, Array(13).fill(literal));
  assert.match(html, /--x:\s*1/);
  assert.doesNotMatch(html, /ordinary build comment/);
  assert.equal(f.run('--check').status, 0);
});

test('an invalid invocation cannot silently regenerate the template', (t) => {
  const f = fixture(t);
  const previous = fs.readFileSync(f.output);
  const result = f.run('--chek');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage:/);
  assert.deepEqual(fs.readFileSync(f.output), previous);
});

for (const placement of ['additional shell slot', 'moved to shell']) {
  test(`Cleanup ownership rejects ${placement} without overwriting output`, (t) => {
    const f = fixture(t);
    const previous = fs.readFileSync(f.output);
    fs.appendFileSync(f.shell, cleanupMarker);
    if (placement === 'moved to shell') {
      fs.writeFileSync(f.export, fs.readFileSync(f.export, 'utf8').replace(cleanupMarker, ''));
    }
    for (const args of [[], ['--check']]) {
      const result = f.run(...args);
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /marker/);
      assert.deepEqual(fs.readFileSync(f.output), previous);
      assert.deepEqual(fs.readdirSync(path.dirname(f.output)), ['template.html']);
    }
  });
}
