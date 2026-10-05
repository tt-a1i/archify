#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'archify/assets/template.html');
// Each fragment maps a marker in `viewer/template.source.html` to a file in
// `viewer/`. The optional indent re-prefixes every non-empty source line so
// the inlined block sits inside the surrounding `<style>` / `<script>` tags at
// the same depth the marker occupies. JS fragments need no indent because their
// markers are already at column 0; the standalone CSS file needs four spaces.
const fragments = [
  ["/* ARCHIFY:INTERVAL_LAYOUT */", "../archify/renderers/interval/interval-layout.mjs"],
  ["/* ARCHIFY:INTERVAL_VALIDATOR */", "../archify/renderers/interval/interval-validator.js"],
  ["/* ARCHIFY:INTERVAL_EDITOR */", "interval-editor.js"],
  ['/* ARCHIFY:VIEWER_CSS */', 'viewer.css', 4],
  ['/* ARCHIFY:EXPORT */', 'export.js'],
  ['/* ARCHIFY:READER_LAYOUT */', 'reader-layout.js'],
  ['/* ARCHIFY:CHROME_LAYOUT */', 'viewer-chrome-layout.js'],
  ['/* ARCHIFY:CAMERA */', 'viewer-camera.js'],
  ['/* ARCHIFY:RADAR */', 'semantic-radar.js'],
  ['/* ARCHIFY:MOTION_GOVERNOR */', 'motion-governor.js'],
  ['/* ARCHIFY:NODE_FINDER */', 'node-finder.js'],
  ['/* ARCHIFY:NODE_OUTLINE */', 'node-outline.js'],
  ['/* ARCHIFY:TREE_BRANCHES */', 'tree-branches.js'],
  ['/* ARCHIFY:FOCUS */', 'focus.js'],
  ['/* ARCHIFY:INTENT_TRACE */', 'intent-trace.js'],
  ['/* ARCHIFY:SEMANTIC_LENS */', 'semantic-lens.js'],
  ['/* ARCHIFY:ROUTE_PROBE */', 'route-probe.js'],
  ['/* ARCHIFY:EXPORT_CLEANUP */', 'export-cleanup.js'],
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
  for (const [marker, file, indent = 0] of fragments) {
    let source = fs.readFileSync(path.join(root, 'viewer', file), 'utf8');
    if (file.endsWith('/interval-layout.mjs')) {
      const grid = fs.readFileSync(path.join(root, 'archify/renderers/shared/svg-grid.mjs'), 'utf8').replace('export function', 'function');
      const units = fs.readFileSync(path.join(root, 'archify/renderers/shared/text-units.mjs'), 'utf8').replace('export function', 'function');
      source = units + '\n' + grid + '\n' + source.replace("import { textUnits } from '../shared/text-units.mjs';\n", '').replace("import { renderGridPattern } from '../shared/svg-grid.mjs';\n", '');
      const exportLine = 'export function renderIntervalLayout';
      if (source.split(exportLine).length !== 2) throw new Error('Interval layout export changed.');
      source = source.replace(exportLine, 'function renderIntervalLayout')
        .replaceAll('<svg', '\\x3csvg').replaceAll('</svg>', '\\x3c/svg>');
      source = `Archify.intervalLayout = (function () {\n${source}\nreturn renderIntervalLayout;\n})();`;
    } else if (file.endsWith('/interval-validator.js')) {
      if (!source.includes('const validateInterval =')) throw new Error('Interval validator export changed.');
      source = `Archify.validateInterval = (function () {\n${source}\nreturn validateInterval;\n})();`;
    }
    const parts = generated.split(marker);
    if (parts.length !== 2) throw new Error(`Viewer source must contain exactly one ${file} marker.`);
    // Export owns the sole nested fragment; expand it before Cleanup.
    const expectedChild = file === childOwner ? childMarker : null;
    if (!source.trim() || (expectedChild && source.split(expectedChild).length !== 2) ||
        fragments.some(([slot]) => source.includes(slot) && slot !== expectedChild)) {
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
