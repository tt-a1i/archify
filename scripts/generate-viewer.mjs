#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'archify/assets/template.html');
const fragments = [
  ['/* ARCHIFY:EXPORT */', 'export.js'],
  ['/* ARCHIFY:READER_LAYOUT */', 'reader-layout.js'],
  ['/* ARCHIFY:CHROME_LAYOUT */', 'viewer-chrome-layout.js'],
  ['/* ARCHIFY:CAMERA */', 'viewer-camera.js'],
  ['/* ARCHIFY:RADAR */', 'semantic-radar.js'],
  ['/* ARCHIFY:MOTION_GOVERNOR */', 'motion-governor.js'],
  ['/* ARCHIFY:NODE_FINDER */', 'node-finder.js'],
  ['/* ARCHIFY:FOCUS */', 'focus.js'],
  ['/* ARCHIFY:INTENT_TRACE */', 'intent-trace.js'],
  ['/* ARCHIFY:SEMANTIC_LENS */', 'semantic-lens.js'],
  ['/* ARCHIFY:ROUTE_PROBE */', 'route-probe.js'],
  ['/* ARCHIFY:GUIDED_VIEWS */', 'guided-views.js'],
  ['/* ARCHIFY:EXPORT_CLEANUP */', 'export-cleanup.js'],
];

try {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--check')) {
    throw new Error('Usage: node scripts/generate-viewer.mjs [--check]');
  }
  let generated = fs.readFileSync(path.join(root, 'viewer/template.source.html'), 'utf8');
  for (const [marker, filename] of fragments) {
    const source = fs.readFileSync(path.join(root, 'viewer', filename), 'utf8');
    const parts = generated.split(marker);
    if (parts.length !== 2) throw new Error(`Viewer source must contain exactly one ${filename} marker.`);
    // Export owns the sole nested fragment; expand it before Cleanup.
    const childMarker = filename === 'export.js' ? '/* ARCHIFY:EXPORT_CLEANUP */' : null;
    if (!source.trim() || (childMarker && source.split(childMarker).length !== 2) ||
        fragments.some(([slot]) => source.includes(slot) && slot !== childMarker)) {
      throw new Error(`${filename} source is empty or contains an unresolved marker.`);
    }
    // Preserve classic-script scope, execution position and literal source bytes,
    // including characters with String.replace semantics.
    generated = parts[0] + source + parts[1];
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
