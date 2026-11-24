import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { extractFacts, loadConfig } from '../lib/analysis.mjs';
import { buildQuestion } from '../lib/explain.mjs';
import { SYNTAX_CASES } from './ts-official-cases.mjs';
import { configuredProgram, officialFixture, sdkPath, ts } from './ts-official-oracle.mjs';

for (const observation of SYNTAX_CASES) test(`official syntax ${observation.id}`, t => {
  const { root } = officialFixture(t, { files: { [observation.entry]: observation.source } });
  const file = path.join(root, observation.entry);
  const { options } = configuredProgram(root, null);
  const program = ts.createProgram([file], { ...options, noResolve: true, noLib: true, types: [] });
  let source = program.getSourceFile(file);
  const hasErrors = program.getSyntacticDiagnostics(source).length > 0;
  // UTF-8 BOM retention is the historical raw-capture representation. Use the
  // public parser on that exact text when checking captured coordinates.
  const bytes = fs.readFileSync(file);
  if (bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) source = ts.createSourceFile(file, bytes.toString('utf8'), options.target, true);
  const { facts } = extractFacts(root, { language: 'ts', config: { ...loadConfig(null), exclude: [], typescript: { sdk: sdkPath } } });
  assert.equal(facts.files[0].sourceText, source.text, 'same source decoding as TypeScript, retaining the declared capture BOM policy');
  assert.equal(Boolean(facts.parse_errors?.length), hasErrors);
  const point = node => {
    const a = source.getLineAndCharacterOfPosition(node.getStart(source));
    const b = source.getLineAndCharacterOfPosition(node.getEnd());
    return [a.line + 1, a.character + 1, b.line + 1, b.character + 1];
  };
  const functions = [], calls = [];
  const visit = node => {
    if (ts.isFunctionLike(node) && node.body) functions.push(point(node));
    if (!hasErrors && !source.isDeclarationFile && ts.isCallExpression(node)) calls.push(point(node));
    ts.forEachChild(node, visit);
  };
  visit(source);
  const sort = values => values.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3] - b[3]);
  assert.deepEqual(sort(facts.functions.map(fn => { const r = fn.sourceRange; return [r.line, r.column, r.endLine, r.endColumn]; })), sort(functions));
  assert.deepEqual(sort(facts.calls.map(call => [call.line, call.column, call.endLine, call.endColumn])), sort(calls));
  if (observation.id.includes('bom') && !source.isDeclarationFile) {
    const question = buildQuestion({ root, facts, entry: observation.entry, symbol: 'run', question: 'Locate the function and its calls.' });
    assert.equal(question.entry.factsStatus, 'valid', 'source questions use the same decoding');
    assert.equal(question.calls.coverage, 'available');
  }
});
