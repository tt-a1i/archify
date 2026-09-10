#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'archify/assets/template.html');
const marker = '/* ARCHIFY:READER_LAYOUT */';

try {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--check')) {
    throw new Error('Usage: node scripts/generate-viewer.mjs [--check]');
  }
  const shell = fs.readFileSync(path.join(root, 'viewer/template.source.html'), 'utf8');
  const reader = fs.readFileSync(path.join(root, 'viewer/reader-layout.js'), 'utf8');
  const parts = shell.split(marker);
  if (parts.length !== 2) throw new Error('Viewer source must contain exactly one Reader Layout marker.');
  if (!reader.trim() || reader.includes(marker)) throw new Error('Reader Layout source is empty or contains an unresolved marker.');

  // Preserve classic-script scope, execution position and literal source bytes,
  // including characters with String.replace semantics.
  const generated = parts[0] + reader + parts[1];
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
