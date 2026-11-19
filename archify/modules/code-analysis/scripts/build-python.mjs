import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = fileURLToPath(new URL('../extract/py/analyze.mjs', import.meta.url));
const provenance = JSON.parse(fs.readFileSync(new URL('../extract/py/upstream/UPSTREAM.json', import.meta.url), 'utf8'));
const result = await build({ absWorkingDir: root, entryPoints: ['extract/py/analyze.ts'], outfile: output,
  bundle: true, platform: 'node', target: 'node18', format: 'esm', write: false, charset: 'utf8',
  legalComments: 'inline', banner: { js: `/*! Python parser derived from microsoft/pyright ${provenance.version} (MIT), Copyright Microsoft Corporation. See extract/py/upstream/LICENSE.txt and UPSTREAM.json. */` } });
const bytes = result.outputFiles[0].contents;
if (process.argv.includes('--check')) {
  const hash = file => createHash('sha256').update(fs.readFileSync(new URL(`../extract/py/upstream/${file}`, import.meta.url))).digest('hex');
  if (hash('LICENSE.txt') !== provenance.license.sha256) throw new Error('Pyright license differs from the recorded upstream license');
  for (const file of provenance.files) if (hash(file.path) !== file.localSha256)
    throw new Error(`Review source changes and refresh Pyright provenance for ${file.path}`);
  if (!fs.existsSync(output) || !fs.readFileSync(output).equals(Buffer.from(bytes))) throw new Error('Python analyzer bundle is stale; run npm run build:python');
} else fs.writeFileSync(output, bytes);
