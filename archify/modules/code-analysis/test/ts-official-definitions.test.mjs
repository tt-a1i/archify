import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { extractFacts, loadConfig } from '../lib/analysis.mjs';
import { DEFINITION_CASES } from './ts-official-cases.mjs';
import { configuredProgram, officialFixture, sdkPath, ts } from './ts-official-oracle.mjs';

for (const observation of DEFINITION_CASES) test(`official language service ${observation.id}`, t => {
  const { root, selected } = officialFixture(t, observation);
  const options = { ...configuredProgram(root, null).options, noLib: true, types: [] };
  const service = ts.createLanguageService({
    getScriptFileNames: () => selected.map(file => path.join(root, file)),
    getScriptVersion: () => '0',
    getScriptSnapshot: file => {
      const text = ts.sys.readFile(file);
      return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
    },
    getCurrentDirectory: () => root,
    getCompilationSettings: () => options,
    getDefaultLibFileName: ts.getDefaultLibFilePath,
    fileExists: ts.sys.fileExists, readFile: ts.sys.readFile, readDirectory: ts.sys.readDirectory,
  });
  t.after(() => service.dispose());
  const { facts } = extractFacts(root, { language: 'ts', config: { ...loadConfig(null), exclude: [], typescript: { sdk: sdkPath } } });
  const file = path.join(root, observation.entry), source = service.getProgram().getSourceFile(file);
  const start = source.text.lastIndexOf(`${observation.call}(`);
  assert.ok(start >= 0);
  const point = source.getLineAndCharacterOfPosition(start);
  const call = facts.calls.find(call => call.file === observation.entry && call.line === point.line + 1 && call.column === point.character + 1);
  assert.ok(call, `missing call ${observation.call}`);
  const position = start + observation.call.length - 1;
  const definitions = service.getDefinitionAtPosition(file, position);
  assert.ok(definitions?.length, 'the official language service offers a definition candidate');
  assert.equal(Boolean(call.target), observation.bound);
  if (!observation.bound) return;
  const targetFile = call.target.file || observation.entry;
  const targetSource = service.getProgram().getSourceFile(path.join(root, targetFile));
  const targetPosition = targetSource.getPositionOfLineAndCharacter(call.target.line - 1, call.target.column - 1);
  assert.ok(definitions.some(definition => path.relative(root, definition.fileName).split(path.sep).join('/') === targetFile
    && definition.contextSpan && definition.contextSpan.start <= targetPosition
    && definition.contextSpan.start + definition.contextSpan.length > targetPosition),
  `captured target agrees with the native definition body: ${JSON.stringify(definitions)}`);
});
