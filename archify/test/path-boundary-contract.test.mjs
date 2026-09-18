import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(here, '../..');
const productionSourceRoots = [
  'archify/bin',
  'archify/delta',
  'archify/migrations',
  'archify/recipes',
  'archify/renderers',
  'archify/scripts',
  'integrations/deepseek-harness/lib',
  'integrations/deepseek-harness/scripts',
  'scripts',
];

function productionSources(relativeRoot) {
  const absoluteRoot = path.join(repositoryRoot, relativeRoot);
  if (!fs.existsSync(absoluteRoot)) return [];
  return fs.readdirSync(absoluteRoot, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.posix.join(relativeRoot, entry.name);
    if (entry.isDirectory()) return productionSources(relativePath);
    return entry.isFile() && /[.](?:mjs|js)$/u.test(entry.name) ? [relativePath] : [];
  });
}

const protectedCallers = productionSourceRoots.flatMap(productionSources).sort();

const exemption = /path-contract-allow:\s*(?:git-path|portable-logical-path|url-path|lexical-capability)\s+--\s+\S/u;
const exemptionMarker = /path-contract-allow:/u;
const pathIdentifier = String.raw`(?:[$A-Z_a-z][$\w]*(?:Path|Root|Directory|Dir|File|Canonical|Location|Resolved)|path|root|directory|dir|file|output|input|target|destination|artifact|receipt|candidate|relative|resolved|canonical)`;
const pathProperty = String.raw`(?:[$A-Z_a-z][$\w.]*\.(?:path|realPath|canonicalPath|root|directory|dir|file|output|input|target|source|destination|artifact|receipt))`;
const pathOperand = String.raw`(?:${pathIdentifier}|${pathProperty})`;
const rawPathEquality = new RegExp(String.raw`\b${pathOperand}\s*(?:===|!==)\s*${pathOperand}\b`, 'u');
const nativePathCall = String.raw`(?:path\.(?:resolve|normalize|dirname|relative|basename)|fs\.realpathSync(?:\.native)?)\s*\(`;
const directNativeEquality = new RegExp(
  String.raw`(?:${nativePathCall}[^;\n]*?\)\s*(?:===|!==)|(?:===|!==)\s*${nativePathCall})`,
  'u',
);
const caseFoldPathKey = new RegExp(
  String.raw`(?:\b${pathIdentifier}|${nativePathCall}[^;\n]*)\.to(?:Locale)?(?:Lower|Upper)Case\s*\(`,
  'u',
);
const pathContainmentCall = new RegExp(String.raw`\b${pathIdentifier}\.(?:startsWith|includes)\s*\(([^)]*)\)`, 'u');
const directNativeContainmentCall = new RegExp(
  String.raw`${nativePathCall}[^;\n]*\.(?:startsWith|includes)\s*\(`,
  'u',
);

function hasValidExemption(lines, index) {
  for (let candidate = index; candidate >= Math.max(0, index - 1); candidate -= 1) {
    if (exemption.test(lines[candidate])) return true;
  }
  return false;
}

function inspectPathBoundarySource(source, file = '<fixture>') {
  const lines = source.split(/\r?\n/u);
  const violations = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*')) continue;

    const validExemption = hasValidExemption(lines, index);
    if (exemptionMarker.test(line) && !exemption.test(line)) {
      violations.push({ file, line: index + 1, rule: 'invalid-exemption' });
      continue;
    }

    if (!validExemption && (rawPathEquality.test(line) || directNativeEquality.test(line))) {
      violations.push({ file, line: index + 1, rule: 'native-path-raw-equality' });
    }
    if (!validExemption && caseFoldPathKey.test(line)) {
      violations.push({ file, line: index + 1, rule: 'native-path-case-fold-key' });
    }

    const containment = pathContainmentCall.exec(line);
    const optionPrefix = containment && line.includes('.startsWith') && /^\s*['"]--/u.test(containment[1]);
    if (!validExemption && ((containment && !optionPrefix) || directNativeContainmentCall.test(line))) {
      violations.push({ file, line: index + 1, rule: 'native-path-string-prefix-containment' });
    }
  }
  for (const rule of [
    ['native-path-raw-equality', rawPathEquality],
    ['native-path-raw-equality', directNativeEquality],
  ]) {
    const pattern = new RegExp(rule[1].source, 'gu');
    for (const match of source.matchAll(pattern)) {
      if (!match[0].includes('\n')) continue;
      const line = source.slice(0, match.index).split(/\r?\n/u).length;
      if (hasValidExemption(lines, line - 1)) continue;
      if (!violations.some((entry) => entry.line === line && entry.rule === rule[0])) {
        violations.push({ file, line, rule: rule[0] });
      }
    }
  }
  return violations;
}

test('path-boundary detector rejects the three native-path regression patterns', () => {
  const violations = inspectPathBoundarySource([
    'if (path.resolve(receipt.output) !== path.resolve(artifactPath)) fail();',
    'const outputKey = outputPath.toLowerCase();',
    "const lockKey = path.basename(outputPath).normalize('NFC').toLocaleUpperCase();",
    'if (targetPath.startsWith(`${rootPath}${path.sep}`)) accept();',
    'if (targetPath.includes(`${path.sep}trusted${path.sep}`)) accept();',
  ].join('\n'));

  assert.deepEqual(violations.map(({ rule }) => rule), [
    'native-path-raw-equality',
    'native-path-case-fold-key',
    'native-path-case-fold-key',
    'native-path-string-prefix-containment',
    'native-path-string-prefix-containment',
  ]);
});

test('path-boundary detector rejects multiline equality and canonical-path properties', () => {
  const violations = inspectPathBoundarySource([
    'if (outputPath ===',
    '    inputPath) fail();',
    'if (left.realPath === right.realPath) fail();',
  ].join('\n'));

  assert.deepEqual(violations.map(({ rule }) => rule), [
    'native-path-raw-equality',
    'native-path-raw-equality',
  ]);
});

test('path-boundary detector rejects native-path equality through resolved aliases', () => {
  const violations = inspectPathBoundarySource(
    'if (leftResolved === rightResolved) fail();',
  );

  assert.deepEqual(violations.map(({ rule }) => rule), [
    'native-path-raw-equality',
  ]);
});

test('path-boundary detector rejects prefix containment through a candidate alias', () => {
  const violations = inspectPathBoundarySource(
    'if (candidate.startsWith(root)) accept();',
  );

  assert.deepEqual(violations.map(({ rule }) => rule), [
    'native-path-string-prefix-containment',
  ]);
});

test('path-boundary detector permits explicit logical-path and lexical-capability exemptions', () => {
  const violations = inspectPathBoundarySource([
    '// path-contract-allow: git-path -- Git tree entries use repository-relative POSIX syntax.',
    "if (sourcePath.startsWith('/')) reject();",
    '// path-contract-allow: lexical-capability -- No-follow snapshots enforce this mutation boundary.',
    'if (relative.startsWith(`..${path.sep}`)) reject();',
  ].join('\n'));

  assert.deepEqual(violations, []);
});

test('production callers do not implement native path identity or containment with strings', () => {
  const violations = protectedCallers.flatMap((relativePath) => {
    const source = fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');
    return inspectPathBoundarySource(source, relativePath);
  });

  assert.deepEqual(
    violations,
    [],
    `Path-boundary regressions must delegate to path-semantics.mjs:\n${violations
      .map(({ file, line, rule }) => `- ${file}:${line} ${rule}`)
      .join('\n')}`,
  );
});
