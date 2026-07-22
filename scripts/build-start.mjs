#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCENARIO_RECIPES } from '../archify/recipes/scenarios.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const templatePath = path.join(__dirname, 'start-template.html');
const outputPath = path.resolve(process.argv[2] || path.join(repoRoot, 'docs/start.html'));
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'archify/package.json'), 'utf8'));

const START_RECIPE_IDS = Object.freeze({
  architecture: 'system-overview',
  workflow: 'agent-tool-call',
  sequence: 'api-request',
  dataflow: 'event-stream',
  lifecycle: 'object-lifecycle',
});

const startData = Object.fromEntries(Object.entries(START_RECIPE_IDS).map(([type, id]) => {
  const recipe = SCENARIO_RECIPES.find((candidate) => candidate.id === id);
  if (!recipe || recipe.type !== type) {
    throw new Error(`Missing canonical start recipe ${JSON.stringify(id)} for ${type}.`);
  }
  return [type, {
    id: recipe.id,
    type: recipe.type,
    proof: recipe.proof,
    presentation: recipe.presentation,
    en: recipe.en,
    zh: recipe.zh,
  }];
}));

const startJson = JSON.stringify(startData)
  .replaceAll('&', '\\u0026')
  .replaceAll('<', '\\u003c')
  .replaceAll('>', '\\u003e');

const replacements = {
  '[[ARCHIFY_VERSION]]': packageJson.version,
  '[[START_JSON]]': startJson,
};

let output = fs.readFileSync(templatePath, 'utf8');
for (const [placeholder, value] of Object.entries(replacements)) {
  output = output.replaceAll(placeholder, value);
}

if (/\[\[[A-Z0-9_]+\]\]/.test(output)) {
  throw new Error('Start template still contains unresolved placeholders.');
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, output);
console.log(`Built ${outputPath} with ${Object.keys(startData).length} bounded starts.`);
