import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const repo = fileURLToPath(new URL('../',import.meta.url));
for (const surface of ['guide','start']) test(`${surface} builder retains literal dollars in recipe copy`, t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'archify-recipe-copy-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(path.join(root,'scripts'),{recursive:true});
  fs.mkdirSync(path.join(root,'archify/recipes'),{recursive:true});
  for(const name of [`build-${surface}.mjs`,`${surface}-template.html`,'site-copy.mjs']) fs.copyFileSync(path.join(repo,'scripts',name),path.join(root,'scripts',name));
  // Asset publication is independently covered; isolate the authored-data build.
  fs.writeFileSync(path.join(root,'scripts/copy-site-assets.mjs'),'export function copySiteAssets() {}');
  fs.writeFileSync(path.join(root,'archify/package.json'),JSON.stringify({version:'3.0.0'}));
  const title = 'Price $& and $` and $\' and $$';
  const recipes=fs.readFileSync(path.join(repo,'archify/recipes/scenarios.mjs'),'utf8').replace("title: 'System overview'",() => `title: ${JSON.stringify(title)}`);
  fs.writeFileSync(path.join(root,'archify/recipes/scenarios.mjs'),recipes);
  const out=path.join(root,'output.html');
  const run=spawnSync(process.execPath,[path.join(root,`scripts/build-${surface}.mjs`),out],{encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  const html=fs.readFileSync(out,'utf8');
  // The recipe's JSON string should round-trip rather than expand into template text.
  const content = new RegExp(`<script id="${surface}-data" type="application/json">([\\s\\S]*?)</script>`).exec(html)[1];
  const data = JSON.parse(content);
  const recipe = surface === 'guide' ? data.find(item => item.id === 'system-overview') : data.architecture;
  assert.equal(recipe.en.title, title, 'authored title remains exact in embedded JSON');
  assert.equal((html.match(/<!DOCTYPE html>/gi)||[]).length,1,'template is not recursively inserted into data');
});
