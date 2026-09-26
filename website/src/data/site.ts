import packageJson from '../../../archify/package.json';
import manifest from '../../../docs/gallery/manifest.json';
import { publicGuideData, SCENARIO_RECIPES, startPromptsFor } from '../../../archify/recipes/scenarios.mjs';
import { CASES } from './gallery-presentation.mjs';

export const version = packageJson.version;
export const guide = publicGuideData();
export const gallery = manifest;
export const cards = CASES.map(item => {
  const proof = manifest.entries.find(entry => entry.id === item.id);
  if (!proof) throw new Error(`Missing validated gallery proof: ${item.id}`);
  return { ...proof, ...item, checksPassed: proof.checks.filter(check => check.ok).length, checkCount: proof.checks.length };
});
const startRecipeIds = {
  architecture: 'system-overview', workflow: 'agent-tool-call', sequence: 'api-request',
  dataflow: 'event-stream', lifecycle: 'object-lifecycle',
};
export const starts = Object.fromEntries(Object.entries(startRecipeIds).map(([type, id]) => {
  const recipe = SCENARIO_RECIPES.find(candidate => candidate.id === id);
  if (!recipe || recipe.type !== type) throw new Error(`Missing start recipe: ${id}`);
  return [type, {
    id: recipe.id, type: recipe.type, proof: recipe.proof, presentation: recipe.presentation,
    en: { ...recipe.en, ...startPromptsFor(recipe, 'en') },
    zh: { ...recipe.zh, ...startPromptsFor(recipe, 'zh') },
  }];
}));
export function jsonScript(value: unknown, pretty = false): string {
  return JSON.stringify(value, null, pretty ? 2 : undefined).replaceAll('&', '\\u0026').replaceAll('<', '\\u003c').replaceAll('>', '\\u003e');
}
export function versioned(value: string): string {
  return value.replaceAll('[[ARCHIFY_VERSION]]', version);
}
