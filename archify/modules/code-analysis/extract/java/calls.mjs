import { children, descendants, tokensOf, TYPE_DECLARATIONS } from './parse.mjs';
import { measureFunctions } from './functions.mjs';

export const CALL_MODEL = 'java-static-lexical-v1';
const OBJECT_METHODS = new Set(['getClass', 'hashCode', 'equals', 'clone', 'toString', 'notify', 'notifyAll', 'wait', 'finalize']);

// Inventory and lexical source navigation are separate: every syntactic method
// invocation is retained, including qualified/chained calls we cannot bind.
export function collectFunctionsAndCalls(unit) {
  const measured = new Map();
  const functions = measureFunctions(unit, (record, node) => measured.set(node, record));
  const contexts = new Map(), declarations = new Map();
  const walk = (node, types = [], method = null, anonymous = false) => {
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
    contexts.set(node, { types, method, anonymous });
    for (const child of children(node)) walk(child, types, method,
      anonymous || (child.name === 'classBody' && node.name === 'unqualifiedClassInstanceCreationExpression'));
  };
  walk(unit.cst);
  const calls = [];
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
      const candidates = (declarations.get(owner) || []).filter(node =>
        node.children.methodHeader[0].children.methodDeclarator[0].children.Identifier[0].image === name);
      if (candidates.length > 1) { call.reason = 'ambiguous-binding'; return; }
      const target = candidates[0];
      if (!target || !measured.has(target)) return;
      const modifiers = target.children.methodModifier || [];
      if (!modifiers.some(modifier => modifier.children.Static)) return;
      const declarator = target.children.methodHeader[0].children.methodDeclarator[0];
      const parameters = [...descendants(declarator)].filter(node => ['variableParaRegularParameter', 'variableArityParameter'].includes(node.name));
      if (parameters.some(node => node.name === 'variableArityParameter')) return;
      if (parameters.length !== (invocation.children.argumentList?.[0]?.children.expression?.length || 0)) return;
      const record = measured.get(target);
      call.resolution = 'same-file-static-method';
      call.target = { name: record.name, line: record.line, column: record.sourceRange.column };
      delete call.reason;
    });
  }
  calls.sort((a, b) => a.line - b.line || a.column - b.column || a.endLine - b.endLine || a.endColumn - b.endColumn);
  return { functions, calls };
}
