#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'archify/assets/template.html');
// Each fragment maps a marker in `viewer/template.source.html` to a file in
// `viewer/`. `indent` re-prefixes every non-empty source line with N spaces so
// the inlined block sits inside the surrounding `<style>` / `<script>` tags at
// the same depth the marker occupies. JS fragments use 0 (the marker is at
// column 0 in `<script>` blocks already); the standalone CSS file is authored
// at column 0 and needs the same 4-space indent the original CSS had.
const fragments = [
  { marker: '/* ARCHIFY:TOKENS */', file: 'tokens.css', indent: 4 },
  { marker: '/* ARCHIFY:EXPORT */', file: 'export.js', indent: 0 },
  { marker: '/* ARCHIFY:READER_LAYOUT */', file: 'reader-layout.js', indent: 0 },
  { marker: '/* ARCHIFY:CHROME_LAYOUT */', file: 'viewer-chrome-layout.js', indent: 0 },
  { marker: '/* ARCHIFY:CAMERA */', file: 'viewer-camera.js', indent: 0 },
  { marker: '/* ARCHIFY:RADAR */', file: 'semantic-radar.js', indent: 0 },
  { marker: '/* ARCHIFY:MOTION_GOVERNOR */', file: 'motion-governor.js', indent: 0 },
  { marker: '/* ARCHIFY:NODE_FINDER */', file: 'node-finder.js', indent: 0 },
  { marker: '/* ARCHIFY:FOCUS */', file: 'focus.js', indent: 0 },
  { marker: '/* ARCHIFY:INTENT_TRACE */', file: 'intent-trace.js', indent: 0 },
  { marker: '/* ARCHIFY:SEMANTIC_LENS */', file: 'semantic-lens.js', indent: 0 },
  { marker: '/* ARCHIFY:ROUTE_PROBE */', file: 'route-probe.js', indent: 0 },
  { marker: '/* ARCHIFY:GUIDED_VIEWS */', file: 'guided-views.js', indent: 0 },
  { marker: '/* ARCHIFY:EXPORT_CLEANUP */', file: 'export-cleanup.js', indent: 0 },
];
const childMarker = '/* ARCHIFY:EXPORT_CLEANUP */';
const childOwner = 'export.js';

function reindent(source, spaces) {
  if (!spaces) return source;
  const pad = ' '.repeat(spaces);
  return source
    .split('\n')
    .map((line) => (line.length === 0 ? line : pad + line))
    .join('\n');
}

try {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--check')) {
    throw new Error('Usage: node scripts/generate-viewer.mjs [--check]');
  }
  let generated = fs.readFileSync(path.join(root, 'viewer/template.source.html'), 'utf8');
  for (const fragment of fragments) {
    const { marker, file, indent } = fragment;
    const source = fs.readFileSync(path.join(root, 'viewer', file), 'utf8');
    const parts = generated.split(marker);
    if (parts.length !== 2) throw new Error(`Viewer source must contain exactly one ${file} marker.`);
    // Export owns the sole nested fragment; expand it before Cleanup.
    const expectedChild = file === childOwner ? childMarker : null;
    if (!source.trim() || (expectedChild && source.split(expectedChild).length !== 2) ||
        fragments.some(({ marker: slot }) => source.includes(slot) && slot !== expectedChild)) {
      throw new Error(`${file} source is empty or contains an unresolved marker.`);
    }
    // For indented fragments the marker line in the template ends with `\n`;
    // `split` leaves that `\n` at the head of `parts[1]`. Strip it so the
    // reindented source's trailing newline is the only separator — without
    // this we'd emit a blank line between the fragment and the surrounding
    // CSS, and every byte after the seam would shift.
    let tail = parts[1];
    if (indent && tail.startsWith('\n')) tail = tail.slice(1);
    // Preserve classic-script scope, execution position and literal source bytes,
    // including characters with String.replace semantics.
    generated = parts[0] + reindent(source, indent) + tail;
  }
  if (args[0] === '--check') {
    if (!fs.existsSync(output) || fs.readFileSync(output, 'utf8') !== generated) {
      throw new Error('Viewer template is stale — run npm run generate:viewer from archify/.');
    }
  } else {
    const temporary = `${output}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(temporary, generated);
      fs.renameSync(temporary, output);
    } finally {
      fs.rmSync(temporary, { force: true });
    }
    console.log('generated archify/assets/template.html');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}