#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicGuideData } from '../archify/recipes/scenarios.mjs';
import { copySiteAssets } from './copy-site-assets.mjs';
import { diagramTypeCopyReplacements } from './site-copy.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const templatePath = path.join(__dirname, 'guide-template.html');
const outputPath = path.resolve(process.argv[2] || path.join(repoRoot, 'docs/guide.html'));
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'archify/package.json'), 'utf8'));

const guideData = publicGuideData();

const guideJson = JSON.stringify(guideData)
  .replaceAll('&', '\\u0026')
  .replaceAll('<', '\\u003c')
  .replaceAll('>', '\\u003e');

const replacements = {
  ...diagramTypeCopyReplacements(),
  '[[ARCHIFY_VERSION]]': packageJson.version,
  '[[RECIPE_COUNT]]': String(guideData.length),
  '[[TYPE_MODE_COUNT]]': String(new Set(guideData.map((recipe) => recipe.type)).size),
  '[[GUIDE_JSON]]': guideJson,
};

let output = fs.readFileSync(templatePath, 'utf8');
for (const [placeholder, value] of Object.entries(replacements)) {
  output = output.replaceAll(placeholder, () => value);
}

if (/\[\[[A-Z0-9_]+\]\]/.test(output)) {
  throw new Error('Guide template still contains unresolved placeholders.');
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
copySiteAssets(outputPath);
fs.writeFileSync(outputPath, output);
console.log(`Built ${outputPath} with ${guideData.length} scenario recipes.`);
