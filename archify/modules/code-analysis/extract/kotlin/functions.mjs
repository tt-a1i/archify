// Function measurements: complexity and nesting on the same scale as the
// other adapters — base 1, then if/loop/catch/when-branch, elvis and &&/||.
// Constructors, init blocks, expression bodies and accessors are measured;
// lambda-bearing property initializers are measured under the property name,
// mirroring the Java adapter's field rule. Nested declarations are measured
// separately and never double-counted in their enclosing body.
import { createHash } from 'node:crypto';
import { extractNestedDeclarations, coveredChecker, measureComplexity } from './bodies.mjs';

export const TYPE_KINDS_MEASURE = new Set(['class', 'interface', 'object', 'enum', 'annotation']);

const sha256 = text => createHash('sha256').update(text).digest('hex');

export function measureFunctions(unit) {
  const records = [];
  const sourceText = unit.sourceText;
  const lineStarts = [0];
  for (const match of sourceText.matchAll(/\r\n|[\r\n]/g)) lineStarts.push(match.index + match[0].length);
  const point = offset => {
    let low = 0, high = lineStarts.length;
    while (low + 1 < high) {
      const middle = (low + high) >>> 1;
      if (lineStarts[middle] <= offset) low = middle;
      else high = middle;
    }
    return { line: low + 1, column: offset - lineStarts[low] + 1 };
  };

  const sourceRangeOf = (start, end) => {
    const a = point(start), b = point(end + 1);
    return {
      line: a.line, column: a.column, endLine: b.line, endColumn: b.column,
      sha256: sha256(sourceText.slice(start, end + 1)),
    };
  };

  function record(decl, name, qualname, owners) {
    if (!decl.bodyRange) return null;
    const nested = extractNestedDeclarations(decl.bodyTokens);
    const coveredBy = coveredChecker(nested.covered);
    const metrics = measureComplexity(decl.bodyTokens, coveredBy, decl.declStart?.startLine ?? decl.startLine);
    const startOffset = decl.declStart?.startOffset ?? decl.startOffset;
    const endOffset = decl.declEnd?.endOffset ?? decl.endOffset;
    const value = {
      file: unit.file, name, qualname,
      line: decl.declStart?.startLine ?? decl.startLine,
      endLine: decl.declEnd?.endLine ?? decl.endLine,
      ...metrics,
      sourceRange: sourceRangeOf(startOffset, endOffset),
      definition: { kind: kindOf(decl), sourceRange: sourceRangeOf(startOffset, endOffset) },
    };
    records.push(value);
    // Nested declarations are measured on their own under <locals>.
    for (const nestedDecl of nested.declarations) {
      walkDeclaration(nestedDecl, [...owners, '<locals>']);
    }
    return value;
  }

  function kindOf(decl) {
    return {
      function: 'KtNamedFunction', constructor: 'KtSecondaryConstructor',
      init: 'KtClassInitializer', property: 'KtProperty',
    }[decl.kind] || 'KtNamedFunction';
  }

  function parameterSignature(decl) {
    return (decl.parameters || []).map(param => {
      // Receiver function types carry a normalized signature of the whole
      // type: the first classifier reference is the receiver, which overloads
      // share even when their lambda parameter lists differ.
      const first = param.typeReferences?.[0];
      const type = first?.functionTypeSignature || first?.name || '?';
      return type + (param.vararg ? '…' : '');
    }).join(',');
  }

  function walkDeclaration(decl, owners) {
    if (!decl) return;
    if (decl.kind === 'enumEntry') {
      const nestedOwners = decl.name ? [...owners, decl.name] : [...owners, '<anonymous>'];
      for (const member of decl.members || []) walkDeclaration(member, nestedOwners);
      return;
    }
    if (TYPE_KINDS_MEASURE.has(decl.kind)) {
      const nestedOwners = decl.name ? [...owners, decl.name] : [...owners, '<anonymous>'];
      for (const member of decl.members || []) walkDeclaration(member, nestedOwners);
      // Object/class member properties with bodies are handled inside members.
      return;
    }
    if (decl.kind === 'function') {
      const signature = parameterSignature(decl);
      const name = decl.name;
      const display = `${name}(${signature})`;
      record(decl, name, [...owners, display].join('.'), owners);
      return;
    }
    if (decl.kind === 'constructor') {
      const signature = parameterSignature(decl);
      const simpleName = owners.at(-1) || 'constructor';
      const display = `${simpleName}(${signature})`;
      record(decl, simpleName, [...owners, display].join('.'), owners);
      return;
    }
    if (decl.kind === 'init') {
      const counts = walkDeclaration.initCounts = walkDeclaration.initCounts || new Map();
      const key = owners.join('.');
      const count = (counts.get(key) || 0) + 1;
      counts.set(key, count);
      const name = count > 1 ? `<init>#${count}` : '<init>';
      record(decl, name, [...owners, name].join('.'), owners);
      return;
    }
    if (decl.kind === 'property') {
      // Initializers/delegates containing a lambda are measured under the
      // property name, mirroring the Java adapter's field rule.
      if (decl.name && (decl.bodyTokens || []).some((token, i) => token.image === '{')) {
        record(decl, decl.name, [...owners, decl.name].join('.'), owners);
      } else if ((decl.bodyTokens || []).length) {
        // Measure nested local declarations even when the property itself is not measured.
        const nested = extractNestedDeclarations(decl.bodyTokens);
        for (const nestedDecl of nested.declarations) walkDeclaration(nestedDecl, [...owners, '<locals>']);
      }
      for (const accessor of decl.accessors || []) {
        if (!(accessor.bodyTokens || []).length || !accessor.bodyRange) continue;
        const accessorDecl = {
          kind: 'function', name: accessor.kind, parameters: [],
          bodyTokens: accessor.bodyTokens, bodyRange: accessor.bodyRange,
          declStart: { startOffset: accessor.startOffset, startLine: accessor.startLine, startColumn: accessor.startColumn },
          declEnd: accessor.bodyRange.close,
          startOffset: accessor.startOffset, startLine: accessor.startLine,
          endLine: accessor.endLine, endOffset: accessor.endOffset,
        };
        const owner = decl.name ? [...owners, decl.name] : owners;
        record(accessorDecl, accessor.kind, [...owner, `${accessor.kind}()`].join('.'), owner);
      }
    }
  }

  for (const decl of unit.declarations) walkDeclaration(decl, []);
  return records.sort((a, b) => a.line - b.line || (a.qualname < b.qualname ? -1 : a.qualname > b.qualname ? 1 : 0));
}
