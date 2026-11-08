import { children, descendants, tokensOf, TYPE_DECLARATIONS } from './parse.mjs';
import { measureFunctions } from './functions.mjs';

export const CALL_MODEL = 'java-static-lexical-v4';
const OBJECT_METHODS = new Set(['getClass', 'hashCode', 'equals', 'clone', 'toString', 'notify', 'notifyAll', 'wait', 'finalize']);

// Fixed argument count can distinguish siblings, but never argument types.
// A varargs sibling needs applicability phases this source model does not run.
function fixedArity(methods, arity) {
  if (methods.some(method => method.varargs)) return { ambiguous: methods.length > 1 };
  const candidates = methods.filter(method => method.arity === arity);
  return { method: candidates.length === 1 ? candidates[0] : undefined, ambiguous: candidates.length > 1 };
}

// Inventory and lexical source navigation are separate: every syntactic method
// invocation is retained, including qualified/chained calls we cannot bind.
export function collectFunctionsAndCalls(unit) {
  const measured = new Map();
  const functions = measureFunctions(unit, (record, node) => measured.set(node, record));
  const contexts = new Map(), declarations = new Map(), publicOwners = new Set();
  const walk = (node, types = [], method = null, anonymous = false, lambda = false) => {
    if (node.name === 'classDeclaration' && (node.children.classModifier || []).some(m => m.children.Public)) {
      for (const owner of node.children.normalClassDeclaration || []) publicOwners.add(owner);
    }
    if (TYPE_DECLARATIONS.has(node.name)) types = [...types, node];
    if (node.name === 'classBody' && anonymous) method = null;
    if (['methodDeclaration', 'interfaceMethodDeclaration', 'constructorDeclaration', 'compactConstructorDeclaration'].includes(node.name)) {
      method = node;
      const owner = types.at(-1);
      if (node.name === 'methodDeclaration' && owner && !anonymous) {
        const list = declarations.get(owner) || [];
        list.push(node); declarations.set(owner, list);
      }
    }
    contexts.set(node, { types, method, anonymous, lambda });
    for (const child of children(node)) walk(child, types, method,
      anonymous || (child.name === 'classBody' && node.name === 'unqualifiedClassInstanceCreationExpression'), lambda || child.name === 'lambdaExpression');
  };
  walk(unit.cst);
  // Value identifiers occupy the expression namespace before an imported class.
  // A method-wide blocker is conservative across control flow and later writes.
  const values = new Map();
  for (const node of descendants(unit.cst)) if (node.name === 'variableDeclaratorId') {
    const context = contexts.get(node), scope = context.method || context.types.at(-1);
    if (!scope) continue;
    if (!values.has(scope)) values.set(scope, new Set());
    for (const token of node.children.Identifier || []) values.get(scope).add(token.image);
  }
  const calls = [], qualifiedCalls = [], staticMethods = [];
  for (const [owner, nodes] of declarations) for (const node of nodes) {
    const declarator = node.children.methodHeader[0].children.methodDeclarator[0];
    const parameters = [...descendants(declarator)].filter(n => ['variableParaRegularParameter', 'variableArityParameter'].includes(n.name));
    staticMethods.push({ ownerOffset: owner.location.startOffset, name: declarator.children.Identifier[0].image,
      ordinaryOwner: owner.name === 'normalClassDeclaration' && !owner.children.classExtends && !owner.children.classImplements,
      publicOwner: publicOwners.has(owner),
      public: (node.children.methodModifier || []).some(m => m.children.Public),
      static: (node.children.methodModifier || []).some(m => m.children.Static),
      arity: parameters.length, varargs: parameters.some(n => n.name === 'variableArityParameter'), record: measured.get(node) });
  }
  for (const primary of descendants(unit.cst)) {
    if (primary.name !== 'primary') continue;
    const prefix = primary.children.primaryPrefix[0];
    const prefixTokens = tokensOf(prefix);
    const suffixes = primary.children.primarySuffix || [];
    suffixes.forEach((suffix, index) => {
      const invocation = suffix.children.methodInvocationSuffix?.[0];
      if (!invocation) return;
      const call = { file: unit.file, line: prefix.location.startLine, column: prefix.location.startColumn,
        endLine: invocation.location.endLine, endColumn: invocation.location.endColumn + 1,
        resolution: 'unresolved', reason: 'unsupported-callee' };
      calls.push(call);
      const context = contexts.get(primary);
      // Qualified type paths are resolved after all captured units are indexed.
      // Do not interpret arbitrary expressions, chained calls or type arguments.
      if (index === 0 && prefixTokens.length >= 3 && prefixTokens.length % 2 === 1
        && prefixTokens.every((token, i) => i % 2 ? token.image === '.' : token.tokenType.name === 'Identifier')) {
        const { types, method, anonymous, lambda } = context, owner = types[0];
        const first = prefixTokens[0].image;
        if (!anonymous && !lambda && types.length === 1 && owner.name === 'normalClassDeclaration'
          && !owner.children.classImplements
          && method?.name === 'methodDeclaration' && measured.has(method)
          && !values.get(owner)?.has(first) && !values.get(method)?.has(first)) {
          qualifiedCalls.push({ call, qualifier: prefixTokens.slice(0, -2).map(t => t.image).join(''),
            name: prefixTokens.at(-1).image, arity: invocation.children.argumentList?.[0]?.children.expression?.length || 0,
            inherited: Boolean(owner.children.classExtends),
            startOffset: primary.location.startOffset, endOffset: invocation.location.endOffset });
        }
      }
      // A sole identifier before the first invocation excludes qualification,
      // invocation type arguments, constructors, references and chained calls.
      if (index !== 0 || prefixTokens.length !== 1 || prefixTokens[0].tokenType.name !== 'Identifier') return;
      const name = prefixTokens[0].image;
      const { types, method, anonymous } = contexts.get(primary);
      const owner = types[0];
      call.reason = 'no-local-function-binding';
      if (anonymous || types.length !== 1 || owner.name !== 'normalClassDeclaration'
        || owner.children.classExtends || owner.children.classImplements
        || method?.name !== 'methodDeclaration' || !measured.has(method) || OBJECT_METHODS.has(name)) return;
      const methods = staticMethods.filter(candidate => candidate.ownerOffset === owner.location.startOffset && candidate.name === name);
      const { method: target, ambiguous } = fixedArity(methods, invocation.children.argumentList?.[0]?.children.expression?.length || 0);
      if (ambiguous) { call.reason = 'ambiguous-binding'; return; }
      if (!target?.record || !target.static) return;
      const record = target.record;
      call.resolution = 'same-file-static-method';
      call.target = { name: record.name, line: record.line, column: record.sourceRange.column };
      delete call.reason;
    });
  }
  calls.sort((a, b) => a.line - b.line || a.column - b.column || a.endLine - b.endLine || a.endColumn - b.endColumn);
  return { functions, calls, qualifiedCalls, staticMethods };
}

// Only public, unique-at-fixed-arity, explicitly static source methods in ordinary top-level
// classes without explicit supertypes are eligible. This does not type-check
// argument applicability, compilation, class loading or execution.
export function resolveQualifiedCalls(units, resolveType, qualifierAncestry) {
  const byFile = new Map(units.map(unit => [unit.file, unit]));
  for (const unit of units) for (const request of unit.qualifiedCalls) {
    const first = request.qualifier.split('.')[0];
    const ancestry = request.inherited ? qualifierAncestry(unit, request, first) : null;
    if (request.inherited && !ancestry?.length) continue;
    // A static import can introduce a value in an expression, even alongside
    // an ordinary import of the same type name. The type-only resolver must
    // not reinterpret that value as the imported class.
    if (unit.imports.some(imp => imp.isStatic && (imp.wildcard || imp.name.split('.').at(-1) === first))) continue;
    const targets = resolveType(unit, { ...request, name: request.qualifier });
    if (targets.length !== 1) continue;
    const type = targets[0], targetUnit = byFile.get(type.file);
    if (type.owners.length || type.kind !== 'normalClassDeclaration') continue;
    const methods = targetUnit.staticMethods.filter(method => method.ownerOffset === type.startOffset && method.name === request.name);
    const { method, ambiguous } = fixedArity(methods, request.arity);
    if (ambiguous) { request.call.reason = 'ambiguous-binding'; continue; }
    if (!method?.record || !method.ordinaryOwner || !method.publicOwner || !method.public || !method.static
      || method.varargs || method.arity !== request.arity) continue;
    const record = method.record;
    request.call.resolution = 'java-qualified-static-method';
    if (ancestry) request.call.qualifierAncestry = ancestry;
    request.call.target = { file: type.file, name: record.name, line: record.line, column: record.sourceRange.column };
    delete request.call.reason;
  }
}
