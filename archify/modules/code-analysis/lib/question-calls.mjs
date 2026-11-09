// Source-contained orientation, never a caller graph or runtime trace.
import ts from 'typescript';
import { validSourceRange } from '../extract/shared/source-range.mjs';
import path from 'node:path';
import { measureFunctions } from '../extract/ts/functions.mjs';

// Saved captures retain their original contract; do not infer support from the
// current producer constant or a numeric adapter revision.
const BINDING_COVERAGE = new Map([
  ['js-ts-lexical-v1', 'declarations-const-initializers-and-relative-named-imports'],
  ['js-ts-lexical-v2', 'declarations-const-initializers-relative-named-imports-and-default-functions'],
  ['js-ts-lexical-v3', 'declarations-const-initializers-relative-imports-and-stable-default-function-references'],
  ['js-ts-lexical-v4', 'declarations-const-initializers-captured-static-imports-and-stable-default-function-references'],
  ['js-ts-lexical-v5', 'declarations-const-initializers-and-stable-explicit-exports-through-captured-value-paths'],
]);

const LIMIT = 40;
const point = (source, offset) => {
  const p = source.getLineAndCharacterOfPosition(offset);
  return { line: p.line + 1, column: p.character + 1 };
};
const before = (aLine, aColumn, bLine, bColumn) => aLine < bLine || (aLine === bLine && aColumn <= bColumn);

export function questionCalls({ facts, factsPath, inspect, entry, location, symbol, text, selectedFunction }) {
  const knownAdapter = facts?.repository?.language === 'ts' && /^typescript@/.test(facts?.repository?.adapter || '');
  const pythonModel = facts?.repository?.language === 'py' && /^python@/.test(facts?.repository?.adapter || '') && ['python-lexical-v1', 'python-lexical-v2'].includes(facts?.callModel);
  const javaAdapter = facts?.repository?.language === 'java' && /^java-parser@/.test(facts?.repository?.adapter || '');
  const javaModel = javaAdapter && ['java-static-lexical-v1', 'java-static-lexical-v2', 'java-static-lexical-v3', 'java-static-lexical-v4', 'java-static-lexical-v5'].includes(facts?.callModel)
    && (facts.callModel !== 'java-static-lexical-v5' || facts.languageScope?.language === 'java');
  const goModel = facts?.repository?.language === 'go' && /^go-parser@/.test(facts?.repository?.adapter || '') && ['go-source-direct-v1', 'go-source-direct-v2', 'go-source-direct-v3', 'go-source-direct-v4'].includes(facts?.callModel);
  const rustModel = facts?.repository?.language === 'rust' && /^rust-syn@/.test(facts?.repository?.adapter || '') && ['rust-source-direct-v1', 'rust-source-direct-v2', 'rust-source-direct-v3', 'rust-source-direct-v4', 'rust-source-direct-v5', 'rust-source-direct-v6', 'rust-source-direct-v7', 'rust-source-direct-v8', 'rust-source-direct-v9'].includes(facts?.callModel);
  const capturedRangeModel = pythonModel || javaModel || goModel || rustModel;
const bindingCoverage = rustModel ? (facts.callModel === 'rust-source-direct-v4' ? 'rust-explicit-functions-and-unique-lifetime-only-inherent-source-candidates-under-declared-cargo-cfg-profile' : facts.callModel === 'rust-source-direct-v3' ? 'rust-explicit-functions-monomorphic-and-unique-concrete-specialization-source-candidates-under-declared-cargo-cfg-profile' : facts.callModel === 'rust-source-direct-v2' ? 'rust-explicit-functions-and-monomorphic-inherent-source-candidates-under-declared-cargo-cfg-profile' : 'rust-explicit-source-functions-under-declared-cargo-cfg-profile') : goModel ? ((['go-source-direct-v3', 'go-source-direct-v4'].includes(facts.callModel)) ? (facts.languageScope?.standardLibrary?.mode === 'disabled' ? 'go-types-direct-functions-concrete-methods-and-interface-declarations-with-sdk-types-disabled' : 'go-types-direct-functions-concrete-methods-and-interface-declarations-with-recorded-sdk-and-incomplete-thirdparty-types') : facts.callModel === 'go-source-direct-v2' ? 'go-types-direct-functions-and-concrete-methods-with-incomplete-external-types' : 'go-types-direct-source-functions-with-incomplete-external-types') : pythonModel ? (facts.callModel === 'python-lexical-v2' ? 'ordinary-module-definitions-direct-imports-and-one-explicit-reexport' : 'ordinary-module-definitions-and-direct-from-import-aliases') : javaModel ? (facts.callModel === 'java-static-lexical-v5' ? 'static-source-candidates-with-captured-parents-and-declared-direct-project-dependencies' : facts.callModel === 'java-static-lexical-v4' ? 'top-level-class-static-source-candidates-with-captured-superclass-value-guards' : facts.callModel === 'java-static-lexical-v3' ? 'top-level-class-unique-fixed-arity-static-source-candidates' : facts.callModel === 'java-static-lexical-v2' ? 'top-level-class-and-explicit-qualified-static-source-candidates' : 'top-level-class-unique-static-fixed-arity-source-candidates') : knownAdapter ? BINDING_COVERAGE.get(facts?.callModel) : undefined;
  const result = {
    coverage: 'unavailable', reason: null,
    provenance: { rawFactsPath: factsPath ? path.resolve(factsPath) : null, adapter: facts?.repository?.adapter ?? null, adapterRevision: facts?.repository?.adapterRevision ?? null,
      snapshotId: facts?.repository?.snapshotId ?? null, callModel: facts?.callModel ?? null },
    bindingCoverage: bindingCoverage ?? 'unknown',
    factRole: 'captured-evidence; use targetNavigation for current target locations',
    selection: { file: entry.file, kind: symbol ? 'function-source-range' : 'entry-file', range: null },
    total: null, included: 0, omitted: null, limit: LIMIT, records: [],
    limitations: [
      'When JS/TS coverage is available, records are JS/TS CallExpressions contained in the selected source range, including nested functions and closures; they are not necessarily direct or executed calls of the selected function. Java java-static-lexical-v1 inventories method invocations, including lambdas and nested types in the selected range, excluding constructors and method references. Historical Python and Java captures without a recognized model do not supply call coverage; empty arrays are not a known zero.',
      'same-file-function identifies a lexical declaration; same-file-function-initializer identifies a direct const initializer. Neither proves execution, TDZ safety or runtime dispatch. Java same-file-static-method is a lexical source candidate only: unique explicit static body method, fixed arity, bare call within a top-level ordinary class without extends/implements; no nested/local/anonymous owners or Object method names. Argument type applicability and compilation are not checked. Named expressions use their measured inner function name. Unresolved calls require source reading; constructors and tagged templates are not collected. imported-function follows captured relative named imports to direct exports; js-ts-lexical-v2 additionally binds direct default function declarations. js-ts-lexical-v3 additionally follows same-module default identifier/export-specifier references to ordinary functions when no source writes or direct eval are observed; factories, variable/function-value references and re-export chains remain unsupported. js-ts-lexical-v4 additionally accepts configured non-relative static imports when module resolution selected an in-project captured implementation; external, excluded, declaration-only and re-export targets remain unsupported. This is lexical source evidence, not runtime callable identity or execution.',
      'Each factIndex identifies the unchanged record in this snapshot raw-facts.calls array. Full start/end ranges distinguish chained calls sharing a start. Original targets are captured evidence only. Use targetNavigation.location only when status is valid; imported targets have separate freshness and parse checks. Valid navigation verifies captured target content and coordinates, not current re-resolution after other files/configuration change.',
      'At most 40 records are included in source order; total/included/omitted describe only the selected range. Read current source or the captured raw facts for omitted records.',
    ],
  };
  if (javaModel && ['java-static-lexical-v2', 'java-static-lexical-v3', 'java-static-lexical-v4', 'java-static-lexical-v5'].includes(facts.callModel)) result.limitations.push('Java v2 additionally follows explicit class-qualified paths to unique public static fixed-arity source methods in public top-level ordinary classes without explicit supertypes. Type/value shadowing, duplicate classes, static value/wildcard imports, overload competition, varargs, inherited owners, lambdas and nested caller scopes can keep targets unknown. This does not type-check argument applicability or establish compilation; valid navigation is captured evidence, not current whole-project re-resolution.');
  if (pythonModel) result.limitations = [
    'Records are captured Python ast.Call sites physically contained in the selected range, including nested functions and defaults; they are not necessarily direct or executed calls of the selected function. Definition ranges exclude preceding decorators.',
    'Targets identify unique ordinary undecorated module-level definitions or direct static from-import aliases. Attributes, classes, decorated targets, shadows and ambiguous bindings remain unresolved. This is lexical source navigation, not runtime callable identity, execution or reachability.',
    'Function ranges use captured UTF-16 coordinates and exact decoded-source slice hashes. Entry and imported target freshness are checked independently. Each factIndex refers to the unchanged captured calls array; at most 40 records are included.',
  ];
  if (javaModel && ['java-static-lexical-v3', 'java-static-lexical-v4', 'java-static-lexical-v5'].includes(facts.callModel)) result.limitations.push('Different fixed arities may select a unique static declaration. Same-arity alternatives and any variable-arity sibling remain unknown; argument typing, generic applicability and full Java overload resolution are not performed.');
  if (['java-static-lexical-v4','java-static-lexical-v5'].includes(facts?.callModel)) result.limitations.push('Java v4 additionally permits explicit class qualifiers in callers extending a closed captured chain of ordinary top-level classes when inherited field names exclude the first qualifier. Inherited member types retain existing type guards. External, incomplete, cyclic or ambiguous ancestry remains unknown; no bare inherited calls, inherited target methods, argument applicability or runtime dispatch is established. Implicit Object contributes no value fields; the type-only JDK allowlist is not a value inventory. Under historical Java v4, new inherited-context targets and ancestor evidence had to stay within one captured Maven/Gradle marker root; cross-build classpaths remain unproved (java-inherited-build-scope). Existing non-inherited source-global candidates are not a Maven/Gradle classpath proof.');
  if (facts?.callModel === 'java-static-lexical-v5') result.limitations.push(...(facts.languageScope?.limitations || []), 'Java v5 admits direct declared project jar/test-jar source routes under recorded default POM properties; buildEvidence identifies captured parent/project/reactor inputs. All recorded metadata must remain fresh. This is not a Maven effective model, artifact resolver or proof of a complete compiler/runtime classpath.');
  if (goModel) result.limitations = [
    ...facts.languageScope.limitations,
    ['go-source-direct-v2', 'go-source-direct-v3', 'go-source-direct-v4'].includes(facts.callModel) ? 'Records inventory Go ast.CallExpr, including type conversions and nested literals. Targets follow captured free functions or compiler-selected concrete method declarations, including promoted methods, expressions and generic instances; interfaces and function variables stay unresolved. No runtime execution, nil safety, argument applicability or complete compilation is proved.' : 'Records inventory Go ast.CallExpr, including type conversions and calls in nested literals; unresolved does not establish callable identity. Targets are captured free-function declarations only; methods, interfaces and function variables are not resolved.',
    'Locations use exact UTF-16 source ranges and hashes. Metadata freshness is checked by the question entrypoint; at most 40 call records are presented. Read languageScope for selected packages, build conditions, excluded files and incomplete typing.',
  ];
  if (rustModel) result.limitations = [...facts.languageScope.limitations, 'Targets identify source declarations under the recorded crate/cfg profile, not compiler type attribution, general macro expansion or runtime dispatch. Records with macroEvidence come from a local macro_rules! invocation that is textually in scope at the callsite and whose single argument expression is used exactly once; the definition location is the captured macro name. Read excluded/opaque regions before interpreting absent callers.'];
  if (pythonModel) result.limitations.push(facts.callModel === 'python-lexical-v2'
    ? 'One unconditional unique explicit from-import reexport may reach a captured ordinary function, including aliases. Longer chains, conditional/rebound/wildcard exports and runtime module initialization remain unproved.'
    : 'Historical python-lexical-v1 does not bind reexports; newer reader capabilities do not expand this saved capture.');
  if (facts?.callModel === 'js-ts-lexical-v5') result.limitations.push('JS/TS v5 follows explicit ESM local/imported function exports over captured acyclic value import/export edges; via records each forwarding statement. Observed writes/eval block imported implementation attribution. Star/type-only/dynamic/CommonJS forwarding and arbitrary value aliases/factory flow remain unsupported. Current forwarding-file freshness is required for target navigation; historical snapshots are not rebound.');
  const unavailable = (reason) => ({ ...result, reason });
  if (entry.factsStatus !== 'valid') return unavailable(`entry-${entry.factsStatus}`);
  if (entry.parseErrors.length) return unavailable('entry-parse-errors');
  if (!bindingCoverage) return unavailable('unsupported-or-unknown-call-model');
  if (!Array.isArray(facts?.calls)) return unavailable('calls-not-captured');

  let range = null;
  if (symbol) {
    if (!location) return unavailable('function-range-unavailable');
    if (capturedRangeModel) {
      if (!validSourceRange(text, selectedFunction, facts.repository.language)) return unavailable('function-range-unavailable');
      const { sha256, ...capturedRange } = selectedFunction.sourceRange;
      range = capturedRange;
    } else {
      // Reuse the extractor's exact naming rules; historical function facts only
      // store lines, which cannot exclude adjacent functions on the same line.
      const source = ts.createSourceFile(entry.file, text, ts.ScriptTarget.Latest, true);
      if (source.parseDiagnostics.length) return unavailable('entry-parse-errors');
      const ranges = [];
      measureFunctions(source, entry.file, (fn, node) => {
        if (fn.qualname === location.symbol && fn.line === location.startLine && fn.endLine === location.endLine) {
          const start = point(source, node.getStart(source)); const end = point(source, node.getEnd());
          ranges.push({ line: start.line, column: start.column, endLine: end.line, endColumn: end.column });
        }
      });
      if (ranges.length !== 1) return unavailable('function-range-unavailable');
      [range] = ranges;
    }
  }
  const records = facts.calls.flatMap((fact, factIndex) => {
    if (fact.file !== entry.file) return [];
    if (range && (!before(range.line, range.column, fact.line, fact.column)
      || !before(fact.endLine, fact.endColumn, range.endLine, range.endColumn))) return [];
    return [{ factIndex, fact }];
  }).sort((a, b) => a.fact.line - b.fact.line || a.fact.column - b.fact.column
    || a.fact.endLine - b.fact.endLine || a.fact.endColumn - b.fact.endColumn || a.factIndex - b.factIndex);
  const capturedFiles = new Set(facts.files.map((file) => file.path));
  const capturedTexts = capturedRangeModel ? new Map(facts.files.map(file => [file.path, file.sourceText])) : null;
  const included = records.slice(0, LIMIT).map((record) => {
    const target = record.fact.target;
    if (!target) return { ...record, targetNavigation: { status: 'unresolved', location: null, reason: record.fact.reason } };
    const file = target.file || entry.file;
    if (!capturedFiles.has(file)) return { ...record, targetNavigation: { status: 'unverifiable', location: null, reason: 'target-not-captured' } };
    if (capturedRangeModel) {
      const measured = (facts.functions || []).filter(fn => fn.file === file && fn.name === target.name && fn.sourceRange?.line === target.line && fn.sourceRange?.column === target.column);
      if (measured.length !== 1 || !validSourceRange(capturedTexts.get(file), measured[0], facts.repository.language)) return { ...record, targetNavigation: { status: 'unverifiable', location: null, reason: 'target-range-unavailable' } };
    }
    const support = {};
    for (const [key, points, prefix] of [
      ['forwarding', record.fact.via, 'forwarding-path'],
      ['qualifierAncestry', record.fact.qualifierAncestry, 'qualifier-ancestry'],
      ['buildEvidence', record.fact.buildEvidence, 'build-evidence'],
      ['macro', record.fact.macroEvidence?.map(item => item.definition), 'macro-definition'],
    ]) {
      if (!points?.length) continue;
      const checked = points.map(point => ({ location: point, evidence: inspect(point.file) }));
      support[key] = checked;
      const stale = checked.find(item => item.evidence.factsStatus !== 'valid' || item.evidence.parseErrors.length);
      if (stale) return { ...record, targetNavigation: { status: 'unverifiable', location: null, reason: prefix + '-' + (stale.evidence.factsStatus === 'valid' ? 'parse-error' : stale.evidence.factsStatus), ...support } };
    }
    const evidence = file === entry.file ? entry : inspect(file);
    const status = evidence.factsStatus === 'valid' && evidence.parseErrors.length ? 'parse-error' : evidence.factsStatus;
    return { ...record, targetNavigation: {
      status, location: status === 'valid' ? { ...target, file } : null,
      ...support,
      ...(status === 'valid' ? {} : { reason: status === 'parse-error' ? 'captured-target-parse-errors' : `target-${status}` }), evidence,
    } };
  });
  return { ...result, coverage: 'available', selection: { ...result.selection, range },
    total: records.length, included: Math.min(records.length, LIMIT), omitted: Math.max(0, records.length - LIMIT), records: included };
}
