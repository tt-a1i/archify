// redundancy/duplicate-block: which lines are compared, how clone classes grow, and what a finding carries.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluate } from '../evaluate/index.mjs';
import { codeLines, duplicateBlocks, thresholds } from '../evaluate/rules/redundancy/duplicate-block.mjs';
import { buildTask } from '../lib/task.mjs';
import { DiagnosticError } from '../core/index.mjs';
import { schemaErrors } from '../schemas/index.mjs';

const CODE = 'redundancy/duplicate-block';
const only = (out) => out.diagnostics.filter((d) => d.code === CODE);

// Twelve distinct statements, long enough to pass the default character threshold.
const block = (prefix = 'value') => Array.from({ length: 12 }, (_, i) => `  const ${prefix}${i} = computeSomethingMeaningful(input.field${i}, options.setting${i});`);
const file = (path, lines, role = 'source') => ({ path, loc: lines.length, role, sourceText: `${lines.join('\n')}\n` });

function run(files, config = {}, language = 'ts') {
  const graph = {
    schema_version: 1, repository: { root: '.', revision: null, url: null, language, adapter: 't' },
    grouping: { depth: 2, packageBoundaries: true, groups: [] }, excluded: { roles: ['test', 'generated'], files: 0 },
    modules: [], edges: [], unresolved: { external: 0, outside: 0, unknown: 0, opaque: 0 },
  };
  const facts = { schema_version: 1, repository: graph.repository, files, symbols: [], calls: [], imports: [], unresolved: { external: 0, outside: 0, unknown: 0, opaque: 0 } };
  return { out: evaluate(graph, config, facts), facts };
}

test('duplicate-block: the same lines in two files are one finding with both ranges', () => {
  const { out } = run([
    file('a.mjs', ['export function a(input, options) {', ...block(), '  return 1;', '}']),
    file('b.mjs', ['// a different header', 'export function b(input, options) {', ...block(), '  return 2;', '}']),
  ]);
  const found = only(out);
  assert.equal(found.length, 1);
  const f = found[0];
  assert.equal(f.severity, 'warning');
  assert.equal(f.confidence, 1);
  assert.deepEqual(f.subject.files, ['a.mjs', 'b.mjs']);
  assert.match(f.subject.block, /^[0-9a-f]{16}$/);
  assert.deepEqual(f.evidence.occurrences, [{ file: 'a.mjs', line: 2, endLine: 13 }, { file: 'b.mjs', line: 3, endLine: 14 }]);
  assert.equal(f.evidence.lines, 12);
  assert.equal(f.evidence.totalOccurrences, 2);
  assert.equal(f.evidence.duplicatedLines, 12);
  assert.deepEqual(f.evidence.threshold, { minLines: 10, minChars: 300 });
  assert.match(f.message, /^12 lines of code are repeated in 2 places: a\.mjs:2-13, b\.mjs:3-14\./);
  assert.match(f.id, /^REDU-[0-9a-f]{12}$/);
  assert.deepEqual(f.evidenceDigest.files, ['a.mjs', 'b.mjs']);
  assert.deepEqual(schemaErrors('findings', out), []);
});

test('duplicate-block: whitespace, comments, blank lines and brace-only lines do not hide a match', () => {
  const reformatted = block().flatMap((line, i) => [i % 3 === 0 ? '' : null, i === 4 ? '    // explains the next line' : null, i === 7 ? ['  /* a block', '     comment */'] : null, `\t\t${line.trim().replace(/ = /, '   =   ')}`, i === 9 ? '  }' : null]).flat().filter((l) => l !== null);
  const found = only(run([file('a.mjs', block()), file('b.mjs', reformatted)]).out);
  assert.equal(found.length, 1);
  assert.equal(found[0].evidence.lines, 12);
});

test('duplicate-block: a single different identifier is not a match; nothing is renamed or abstracted', () => {
  const changed = block();
  changed[5] = changed[5].replace('value5', 'other5');
  assert.deepEqual(only(run([file('a.mjs', block()), file('b.mjs', changed)]).out), [], 'two runs of 5 and 6 equal lines are both below minLines');
  assert.deepEqual(only(run([file('a.mjs', block('left')), file('b.mjs', block('right'))]).out), []);
});

test('duplicate-block: a match grows in both directions to its full extent and is reported once', () => {
  const long = [...block('head'), ...block('tail')];
  const found = only(run([file('a.mjs', ['const before = 1;', ...long, 'const afterA = 1;']), file('b.mjs', [...long, 'const afterB = 2;'])]).out);
  assert.equal(found.length, 1);
  assert.equal(found[0].evidence.lines, 24);
  assert.deepEqual(found[0].evidence.occurrences, [{ file: 'a.mjs', line: 2, endLine: 25 }, { file: 'b.mjs', line: 1, endLine: 24 }]);
});

test('duplicate-block: three copies are one finding; a longer match between two of them is a second one', () => {
  const shared = block('shared'), extra = block('extra');
  const found = only(run([file('a.mjs', [...shared, ...extra]), file('b.mjs', [...shared, ...extra]), file('c.mjs', [...shared, 'const own = 1;'])]).out)
    .sort((a, b) => b.evidence.lines - a.evidence.lines);
  assert.deepEqual(found.map((f) => [f.evidence.lines, f.evidence.totalOccurrences, f.subject.files]), [[24, 2, ['a.mjs', 'b.mjs']], [12, 3, ['a.mjs', 'b.mjs', 'c.mjs']]]);
  assert.notEqual(found[0].id, found[1].id, 'two blocks in the same files keep distinct ids');
});

test('duplicate-block: the id follows the repeated text, not where the copies are', () => {
  const before = only(run([file('a.mjs', block()), file('b.mjs', block())]).out)[0];
  const moved = only(run([file('a.mjs', ['const added = 1;', ...block()]), file('lib/renamed.mjs', block())]).out)[0];
  assert.equal(moved.id, before.id);
  const third = only(run([file('a.mjs', block()), file('b.mjs', block()), file('c.mjs', block())]).out)[0];
  assert.equal(third.id, before.id, 'another copy is the same problem, grown');
  assert.equal(third.evidence.totalOccurrences, 3);
});

test('duplicate-block: copies inside one file are reported and never overlap themselves', () => {
  const found = only(run([file('a.mjs', [...block(), 'const between = 1;', ...block()])]).out);
  assert.equal(found.length, 1);
  assert.deepEqual(found[0].evidence.occurrences, [{ file: 'a.mjs', line: 1, endLine: 12 }, { file: 'a.mjs', line: 14, endLine: 25 }]);
  assert.match(found[0].message, /in 2 places in one file/);
  // A table of one repeated row matches itself at every offset; that is not a copied block.
  const row = '  registerHandlerForEveryKnownEventTypeInTheSystem(table, configuration);';
  assert.deepEqual(only(run([file('rows.mjs', Array.from({ length: 60 }, () => row))]).out), []);
});

test('duplicate-block: import lists, test files and generated files are not compared', () => {
  const imports = ['import {', ...Array.from({ length: 14 }, (_, i) => `  helperNumber${i}WithALongDescriptiveName,`), "} from '../shared/helpers.mjs';", ...Array.from({ length: 12 }, (_, i) => `import { thing${i} } from '../shared/thing-with-a-long-name-${i}.mjs';`)];
  assert.deepEqual(only(run([file('a.mjs', [...imports, 'export const a = 1;']), file('b.mjs', [...imports, 'export const b = 2;'])]).out), []);
  assert.deepEqual(only(run([file('a.mjs', block()), file('a.test.mjs', block(), 'test'), file('generated-b.mjs', block(), 'generated')]).out), []);
});

test('duplicate-block: Python docstrings and comments are skipped; the code around them still matches', () => {
  const body = Array.from({ length: 12 }, (_, i) => `    result_${i} = transform_the_value(payload["field_${i}"], settings.option_${i})`);
  const doc = (text) => ['    r"""', `    ${text}`, '', '    :param payload: the same parameter documentation in both functions', '    """'];
  const shared = Array.from({ length: 14 }, (_, i) => `    :param name_${i}: identical documentation line number ${i} for both functions`);
  const lines = codeLines(['def f(payload, settings):', ...doc('one'), '    # comment', ...body].join('\n'), 'py');
  assert.deepEqual(lines.map((l) => l.line), [1, ...body.map((_, i) => 8 + i)]);
  // Identical docstrings alone are documentation, not duplicated logic.
  const docOnly = (name) => file(`${name}.py`, [`def ${name}(payload, settings):`, '    """', ...shared, '    """', `    return ${name}_impl(payload, settings)`]);
  assert.deepEqual(only(run([docOnly('first'), docOnly('second')], {}, 'py').out), []);
  const found = only(run([file('a.py', ['def a(payload, settings):', ...doc('first'), ...body]), file('b.py', ['def b(payload, settings):', ...doc('second'), ...body])], {}, 'py').out);
  assert.equal(found.length, 1);
  assert.equal(found[0].evidence.lines, 12);
});

test('duplicate-block: short or low-content repeats stay below the thresholds, which are configurable and validated', () => {
  const nine = block().slice(0, 9);
  assert.deepEqual(only(run([file('a.mjs', nine), file('b.mjs', nine)]).out), []);
  assert.equal(only(run([file('a.mjs', nine), file('b.mjs', nine)], { rules: { redundancy: { duplicateBlock: { minLines: 9 } } } }).out).length, 1);
  const terse = Array.from({ length: 12 }, (_, i) => `  a${i}: ${i},`);
  assert.deepEqual(only(run([file('a.mjs', terse), file('b.mjs', terse)]).out), [], 'twelve short lines are under minChars');
  assert.equal(only(run([file('a.mjs', terse), file('b.mjs', terse)], { rules: { redundancy: { duplicateBlock: { minChars: 0 } } } }).out).length, 1);
  for (const [key, value] of [['minLines', 2], ['minLines', '10'], ['minChars', -1], ['minChars', 1.5]]) {
    assert.throws(() => thresholds({ rules: { redundancy: { duplicateBlock: { [key]: value } } } }),
      (e) => e instanceof DiagnosticError && e.diagnostics[0].code === 'config/threshold-invalid' && e.diagnostics[0].subject.option === `rules.redundancy.duplicateBlock.${key}`, `${key}=${value}`);
  }
});

test('duplicate-block: the rule does not run without captured source, and says so by leaving the rule list', () => {
  const graph = { schema_version: 1, repository: { root: '.', revision: null, url: null, language: 'ts', adapter: 't' }, grouping: { depth: 2, packageBoundaries: true, groups: [] }, excluded: { roles: [], files: 0 }, modules: [], edges: [], unresolved: { external: 0, outside: 0, unknown: 0, opaque: 0 } };
  assert.ok(!evaluate(graph, {}).rules.includes(CODE), 'not checked is never reported as clean');
  assert.ok(run([file('a.mjs', block())]).out.rules.includes(CODE));
});

test('duplicate-block: results do not depend on file order', () => {
  const files = [file('z.mjs', [...block('p'), ...block('q')]), file('m.mjs', block('q')), file('a.mjs', [...block('p'), 'const x = 1;', ...block('q')])];
  const ids = (list) => only(run(list).out).map((f) => [f.id, f.evidence.occurrences]);
  assert.deepEqual(ids(files), ids([...files].reverse()));
  assert.equal(duplicateBlocks([], { minLines: 10, minChars: 300 }).length, 0);
});

test('duplicate-block: an AI task lists every copy as a range to change and how the finding is resolved', () => {
  const { out, facts } = run([file('a.mjs', ['export function a(input, options) {', ...block(), '}']), file('b.mjs', ['export function b(input, options) {', ...block(), '}'])]);
  const finding = only(out)[0];
  const task = buildTask({ findings: out, facts, ids: [finding.id] });
  assert.equal(task.title, 'Remove the 12-line block repeated in 2 places');
  assert.deepEqual(task.locations.map((l) => [l.file, l.startLine, l.endLine, l.kind, l.note]), [['a.mjs', 2, 13, 'range', 'copy 1 of 2'], ['b.mjs', 2, 13, 'range', 'copy 2 of 2']]);
  assert.deepEqual(task.scope.modify, ['a.mjs', 'b.mjs']);
  assert.match(task.acceptance[0], /^The 12 repeated lines exist in one place that the others call .*or the copies are confirmed as meant to diverge/);
  assert.match(task.impact[0].statement, /a missed copy becomes a bug/);
  assert.deepEqual(schemaErrors('ai-task', task), []);
});
