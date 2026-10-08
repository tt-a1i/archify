import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { generateViewer } from '../scripts/generate-viewer.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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
const treeMarker = '/* ARCHIFY:TREE_BRANCHES */';
const intentMarker = '/* ARCHIFY:INTENT_TRACE */';
const lensMarker = '/* ARCHIFY:SEMANTIC_LENS */';
const routeMarker = '/* ARCHIFY:ROUTE_PROBE */';
const focusMarker = '/* ARCHIFY:FOCUS */';
const fragments = { viewerCss: viewerCssMarker, export: exportMarker, reader: marker, cleanup: cleanupMarker, chrome: chromeMarker, camera: cameraMarker, radar: radarMarker, motion: motionMarker, finder: finderMarker, outline: outlineMarker, tree: treeMarker, intent: intentMarker, lens: lensMarker, route: routeMarker, focus: focusMarker };

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-viewer-build-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.mkdirSync(path.join(root, 'archify/assets'), { recursive: true });
  fs.mkdirSync(path.join(root, 'archify/renderers/shared'), { recursive: true });
  fs.copyFileSync(path.join(repoRoot, 'archify/renderers/shared/path-semantics.mjs'), path.join(root, 'archify/renderers/shared/path-semantics.mjs'));
  fs.cpSync(path.join(repoRoot, 'viewer'), path.join(root, 'viewer'), { recursive: true });
  fs.copyFileSync(path.join(repoRoot, 'scripts/generate-viewer.mjs'), path.join(root, 'scripts/generate-viewer.mjs'));
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
    tree: path.join(root, 'viewer/tree-branches.js'),
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

test('Viewer generation runs through a preserved symlink entry', (t) => {
  const f = fixture(t);
  const script = path.join(f.root, 'scripts/generate-viewer.mjs');
  const alias = path.join(f.root, 'scripts/generate-viewer-alias.mjs');
  try {
    fs.symlinkSync(script, alias);
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) {
      t.skip(`symlinks unavailable: ${error.code}`);
      return;
    }
    throw error;
  }
  const previous = fs.readFileSync(f.output);
  fs.unlinkSync(f.output);
  const result = spawnSync(process.execPath, ['--preserve-symlinks-main', alias], {
    cwd: os.tmpdir(), encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'generated archify/assets/template.html');
  assert.deepEqual(fs.readFileSync(f.output), previous);
});

test('importing the generator with an unavailable entry path does not run or throw', (t) => {
  const f = fixture(t);
  const previous = fs.readFileSync(f.output);
  const moduleUrl = pathToFileURL(path.join(f.root, 'scripts/generate-viewer.mjs')).href;
  const missingEntry = path.join(f.root, 'scripts/missing-entry.mjs');
  const result = spawnSync(process.execPath, ['--input-type=module', '-e',
    `process.argv[1] = ${JSON.stringify(missingEntry)}; await import(${JSON.stringify(moduleUrl)}); console.log('imported');`], {
    cwd: os.tmpdir(), encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'imported');
  assert.deepEqual(fs.readFileSync(f.output), previous);
});

test('editing any authoritative source requires explicit regeneration', (t) => {
  const f = fixture(t);
  for (const input of [f.shell, f.viewerCss, f.export, f.reader, f.cleanup, f.chrome, f.camera, f.radar, f.motion, f.finder, f.outline, f.tree, f.intent, f.lens, f.route, f.focus]) {
    const previous = fs.readFileSync(f.output);
    fs.appendFileSync(input, '\n/* source change */\n');
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

test('assembly failure matrix preserves a valid artifact', { concurrency: false }, async (t) => {
  const f = fixture(t);
  // Marker rejection depends on source structure, not production bundle size.
  // The CLI tests above and below retain the complete authoritative sources.
  const shellSlots = Object.values(fragments).filter(slot => slot !== cleanupMarker && slot !== viewerCssMarker);
  fs.writeFileSync(f.shell, `<style>\n${viewerCssMarker}\n</style><script>\n${shellSlots.join('\n')}\n</script>\n`);
  for (const fragment of Object.keys(fragments)) {
    fs.writeFileSync(f[fragment], `/* ${fragment} source */\n${fragment === 'export' ? `${cleanupMarker}\n` : ''}`);
  }
  generateViewer({ root: f.root });
  // Each case restores its mutations before the next awaited subtest starts.
  for (const [fragment, slot] of Object.entries(fragments)) {
    for (const failure of ['missing shell', 'missing fragment', 'missing marker', 'duplicate marker', 'empty fragment', ...Object.keys(fragments).map(name => `${name} marker`)]) {
      await t.test(`assembly rejects ${fragment}: ${failure} without overwriting a valid artifact`, () => {
        const previous = fs.readFileSync(f.output);
        const owner = fragment === 'cleanup' ? f.export : f.shell;
        const sources = new Map([f.shell, f[fragment], owner].map(file => [file, fs.readFileSync(file)]));
        try {
          if (failure === 'missing shell') fs.unlinkSync(f.shell);
          if (failure === 'missing fragment') fs.unlinkSync(f[fragment]);
          if (failure === 'missing marker') fs.writeFileSync(owner, fs.readFileSync(owner, 'utf8').replace(slot, ''));
          if (failure === 'duplicate marker') fs.appendFileSync(owner, slot);
          if (failure === 'empty fragment') fs.writeFileSync(f[fragment], ' \n');
          const embeddedSlot = fragments[failure.replace(/ marker$/, '')];
          if (embeddedSlot) fs.appendFileSync(f[fragment], embeddedSlot);
          for (const check of [false, true]) {
            assert.throws(() => generateViewer({ root: f.root, check }), /ENOENT|marker|empty/, failure);
            assert.deepEqual(fs.readFileSync(f.output), previous);
            assert.deepEqual(fs.readdirSync(path.dirname(f.output)), ['template.html']);
          }
        } finally {
          for (const [file, bytes] of sources) fs.writeFileSync(file, bytes);
          fs.writeFileSync(f.output, previous);
        }
      });
    }
  }
});

test('assembly preserves literal replacement tokens, Unicode and source line endings', (t) => {
  const f = fixture(t);
  const reader = '// $& $\' $` $$ 中文 \u{1f5fa}\r\n(function () {})();\r\n';
  const css = '/* === TOKENS === */\r\n:root { --x: 1; }\r\n';
  fs.writeFileSync(f.shell, `<style>${viewerCssMarker}</style><script>\r\n${focusMarker}${routeMarker}${lensMarker}${intentMarker}${finderMarker}${outlineMarker}${treeMarker}${motionMarker}${radarMarker}${cameraMarker}${chromeMarker}${exportMarker}${marker}</script>\n`);
  fs.writeFileSync(f.viewerCss, css);
  fs.writeFileSync(f.export, reader + cleanupMarker);
  fs.writeFileSync(f.cleanup, reader);
  fs.writeFileSync(f.chrome, reader);
  fs.writeFileSync(f.camera, reader);
  fs.writeFileSync(f.radar, reader);
  fs.writeFileSync(f.motion, reader);
  fs.writeFileSync(f.finder, reader);
  fs.writeFileSync(f.outline, reader);
  fs.writeFileSync(f.tree, reader);
  fs.writeFileSync(f.intent, reader);
  fs.writeFileSync(f.lens, reader);
  fs.writeFileSync(f.route, reader);
  fs.writeFileSync(f.focus, reader);
  fs.writeFileSync(f.reader, reader);
  const generated = f.run();
  assert.equal(generated.status, 0, generated.stderr);
  // The viewer.css file is inlined inside the <style> block. The marker sits
  // at column 0 inside the shell so every line of the CSS gets a 4-space
  // reindent, including the first. The <script> block then contains the JS
  // fragments unchanged. Both the leading `\n` after the marker and the
  // marker line itself are stripped from `parts[1]` so the reindented CSS
  // ends flush with the closing </style> tag.
  const indentedCss = css.split('\n').map((line) => line.length === 0 ? line : '    ' + line).join('\n');
  assert.equal(
    fs.readFileSync(f.output, 'utf8'),
    `<style>${indentedCss}</style><script>\r\n${reader}${reader}${reader}${reader}${reader}${reader}${reader}${reader}${reader}${reader}${reader}${reader}${reader}${reader}</script>\n`,
  );
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
