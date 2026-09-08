import fs from 'node:fs';
import { helper, other } from './lib/helper.mjs';
export { helper } from './lib/helper.mjs';
import * as gen from './generated-table.mjs';

export async function main() {
  const lazy = await import('./lib/lazy.mjs');
  const missing = await import('./lib/does-not-exist.mjs');
  return [fs, helper, other, gen, lazy, missing];
}
