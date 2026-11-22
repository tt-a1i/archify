// Manual two-SDK probe using unchanged Vue source files in isolated package
// copies. The temporary SDK links only select analyzers; no source executes.
// node test/ts-multi-repo-probe.mjs <Vue core checkout> <SDK A> <SDK B>
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extractFacts } from '../lib/analysis.mjs';
import { schemaErrors } from '../extract/shared/schema.mjs';

const [, , vueRoot, sdkA, sdkB] = process.argv;
if (!vueRoot || !sdkA || !sdkB) {
  process.stderr.write('Pass a Vue core checkout and two TypeScript package directories.\n');
  process.exitCode = 2;
} else {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-ts-vue-multi-'));
  try {
    for (const [target, source, sdk] of [
      ['a', 'reactivity', sdkA], ['b', 'shared', sdkB],
    ]) {
      const destination = path.join(root, target);
      fs.mkdirSync(path.join(destination, 'node_modules'), { recursive: true });
      fs.cpSync(path.join(vueRoot, 'packages', source, 'src'), path.join(destination, 'src'), { recursive: true });
      fs.copyFileSync(path.join(vueRoot, 'packages', source, 'package.json'), path.join(destination, 'package.json'));
      fs.symlinkSync(path.resolve(sdk), path.join(destination, 'node_modules/typescript'), 'dir');
    }
    const { facts } = extractFacts(root, { language: 'ts' });
    assert.deepEqual(schemaErrors('raw-facts', facts), []);
    assert.equal(facts.repository.adapter, 'typescript@multi');
    assert.equal(facts.languageScope.sdks.length, 2);
    assert.ok(facts.languageScope.projects.every(project => project.files.every(file => file.startsWith(project.sdkIndex === 0 ? 'a/' : 'b/'))));
    process.stdout.write(`${JSON.stringify({ source: fs.realpathSync(vueRoot),
      sdks: facts.languageScope.sdks.map(({ version, source, status }) => ({ version, source, status })),
      projects: facts.languageScope.projects.map(({ sdkIndex, sdkVersion, files }) => ({ sdkIndex, sdkVersion, files: files.length })),
      files: facts.files.length, imports: facts.imports.length, resolvedImports: facts.imports.filter(item => item.resolved).length,
      functions: facts.functions.length, calls: facts.calls.length, boundCalls: facts.calls.filter(item => item.target).length,
      parseErrors: facts.parse_errors?.length ?? 0 })}\n`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
