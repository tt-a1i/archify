// The browser half of the analysis view lives in overlay/client/ as ordinary
// .css and .js files, so editors, linters and this module's own analysis read
// them as code. They are inlined into the delivered page at build time: the
// page stays one self-contained HTML file and nothing is fetched at runtime.
//
// Each script is a classic (non-module) IIFE that reads the JSON payload
// embedded next to it; it must not use import/export. The leading newline keeps
// the opening tag on its own line in the generated HTML.
import fs from 'node:fs';

const cache = new Map();

export function clientAsset(name) {
  if (!cache.has(name)) cache.set(name, `\n${fs.readFileSync(new URL(`./client/${name}`, import.meta.url), 'utf8')}`);
  return cache.get(name);
}
