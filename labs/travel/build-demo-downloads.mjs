import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// Package only the named standalone demo, never the surrounding checkout.
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-demo-download-'));
for (const city of ['shanghai', 'paris']) {
  const root = path.join(stage, city);
  fs.mkdirSync(root);
  const name = `${city}.html`;
  const html = fs.readFileSync(new URL(`./demo/${name}`, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
  fs.writeFileSync(path.join(root, name), html);
  const modes = path.join(stage, `${city}-modes.json`);
  fs.writeFileSync(modes, JSON.stringify({[name]: '100644'}));
  execFileSync(process.execPath, [
    fileURLToPath(new URL('../../scripts/write-deterministic-zip.mjs', import.meta.url)),
    root, fileURLToPath(new URL(`./demo/${city}.zip`, import.meta.url)),
    '--mode-manifest', modes,
  ], {stdio: 'inherit'});
}
