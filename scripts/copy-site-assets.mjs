import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourceRoot = path.resolve(__dirname, '../docs/assets');
const SITE_ASSETS = Object.freeze([
  'site-language.js',
  'site-navigation.css',
]);

export function copySiteAssets(outputHtmlPath) {
  const targetRoot = path.join(path.dirname(path.resolve(outputHtmlPath)), 'assets');
  fs.mkdirSync(targetRoot, { recursive: true });

  for (const asset of SITE_ASSETS) {
    const source = path.join(sourceRoot, asset);
    const target = path.join(targetRoot, asset);
    if (path.resolve(source) !== path.resolve(target)) fs.copyFileSync(source, target);
  }
}
