// Lexical declaration bindings, not runtime dispatch or execution evidence.
import ts from 'typescript';

// v2 adds direct default function declarations to v1's relative named imports.
// Unlike adapter revisions, this identifier describes the emitted call contract.
export const CALL_MODEL = 'js-ts-lexical-v2';

function point(source, node) {
  const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source));
  return { line: line + 1, column: character + 1 };
}

export function callsite(node, source, file, checker, functionRecords) {
  const end = source.getLineAndCharacterOfPosition(node.getEnd());
  const record = { file, ...point(source, node), endLine: end.line + 1, endColumn: end.character + 1 };
  const unknown = (reason) => ({ ...record, resolution: 'unresolved', reason });
  if (node.questionDotToken) return unknown('optional-call');
  if (!ts.isIdentifier(node.expression)) return unknown('unsupported-callee');
  const declarations = checker.getSymbolAtLocation(node.expression)?.declarations || [];
  if (declarations.some(ts.isVariableDeclaration)) {
    if (declarations.length !== 1) return unknown('ambiguous-binding');
    const declaration = declarations[0];
    const initializer = declaration.initializer;
    if (declaration.getSourceFile() !== source || !ts.isIdentifier(declaration.name)
      || !ts.isVariableDeclarationList(declaration.parent) || !(declaration.parent.flags & ts.NodeFlags.Const)
      || !initializer || !(ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))) return unknown('no-local-function-binding');
    const measured = functionRecords.get(initializer);
    if (!measured) return unknown('no-local-function-binding');
    return { ...record, resolution: 'same-file-function-initializer', target: { name: measured.name, ...point(source, initializer) } };
  }
  if (!declarations.length || !declarations.some(ts.isFunctionDeclaration)) return unknown('no-local-function-binding');
  if (declarations.some((d) => !ts.isFunctionDeclaration(d))) return unknown('ambiguous-binding');
  const bodies = declarations.filter((d) => d.body);
  if (bodies.length !== 1) return unknown(bodies.length ? 'ambiguous-binding' : 'no-local-function-binding');
  const target = bodies[0];
  if (target.getSourceFile() !== source) return unknown('no-local-function-binding');
  if (declarations.some((d) => d.getSourceFile() !== source)) return unknown('ambiguous-binding');
  if (!target.name) return unknown('no-local-function-binding');
  // The checker can name a body declaration for valid JS parameter defaults,
  // but that body is outside the parameter's scope. Check every enclosing
  // parameter, including destructuring defaults and closures in initializers;
  // declarations inside those initializer-created scopes remain available.
  for (let scope = node.parent; scope; scope = scope.parent) {
    if (!ts.isParameter(scope)) continue;
    const body = scope.parent.body;
    if (body && body.pos <= target.pos && target.end <= body.end) return unknown('no-local-function-binding');
  }
  return { ...record, resolution: 'same-file-function', target: { name: target.name.text, ...point(source, target) } };
}
