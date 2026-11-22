// Manual compatibility probe: node test/ts-version-probe.mjs <typescript package dir>...
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { extractFacts } from '../lib/analysis.mjs';

const sdks = process.argv.slice(2);
if (!sdks.length) {
  process.stderr.write('Pass one or more TypeScript package directories.\n');
  process.exitCode = 2;
} else {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-ts-version-probe-'));
  try {
    fs.mkdirSync(path.join(root, 'lib'));
    fs.writeFileSync(path.join(root, 'jsconfig.json'), JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@lib/*': ['lib/*'] } } }));
    fs.writeFileSync(path.join(root, 'main.js'), 'import { run } from "@lib/run"; run();');
    fs.writeFileSync(path.join(root, 'lib/run.js'), 'export function run() {}');
    const defaults = JSON.parse(fs.readFileSync(new URL('../config/defaults.json', import.meta.url), 'utf8'));
    for (const sdk of sdks) {
      const started = performance.now();
      const { facts } = extractFacts(root, { language: 'ts', config: { ...defaults, typescript: { sdk: path.resolve(sdk) } } });
      const result = {
        sdk: facts.languageScope.sdk,
        config: facts.languageScope.projects[0]?.config,
        files: facts.files.map(file => file.path),
        importTarget: facts.imports[0]?.to ?? null,
        callResolution: facts.calls[0]?.resolution ?? null,
        elapsedMs: Math.round(performance.now() - started),
      };
      process.stdout.write(`${JSON.stringify(result)}\n`);
      if (result.importTarget !== 'lib/run.js' || result.files.length !== 2 || result.callResolution !== 'imported-function') process.exitCode = 1;
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
