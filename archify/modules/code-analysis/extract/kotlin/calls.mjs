// Call inventory and conservative lexical binding, model kotlin-static-lexical-v1.
//
// Inventories lowercase/simple or qualified invocation sites inside measured
// bodies. A call binds only when all of these hold, mirroring the Java v1
// binding discipline adapted to Kotlin semantics:
//   - unqualified callee (no receiver, no chaining)
//   - the enclosing owner chain is exactly one class/object with no explicit
//     supertypes, or the caller is a top-level/companion/object function
//   - exactly one same-scope candidate declaration with a body exists
//   - fixed arity matches and no candidate has default values or vararg
//   - no explicit import binds the same simple name (imports win over scope)
//   - the name is not shadowed and not an object/classifier name
// Anything else stays unresolved with a reason. This is a source candidate,
// never proof of compilation, applicability or runtime dispatch.
import { createHash } from 'node:crypto';
import { extractNestedDeclarations, coveredChecker, scanCallSites } from './bodies.mjs';

export const CALL_MODEL = 'kotlin-static-lexical-v1';

const TYPE_KINDS_CALL = new Set(['class', 'interface', 'object', 'enum', 'annotation']);

export function collectCalls(unit, described) {
  const calls = [];
  // Inventory of function declarations per owner scope for binding.
  // scopeKey: 'topLevel' or the owning type's declaration start offset.
  const scopeFunctions = new Map();
  const indexScope = (scopeKey, decl) => {
    if (!scopeFunctions.has(scopeKey)) scopeFunctions.set(scopeKey, []);
    scopeFunctions.get(scopeKey).push(decl);
  };

  // Build the scope index from the declaration tree: top-level functions,
  // and member functions of each class/object. Only ordinary classes/objects
  // without supertypes are bindable scopes, matching the Java v1 discipline.
  function indexDeclarations(decls, ownerChain, scopeKey) {
    for (const decl of decls) {
      if (TYPE_KINDS_CALL.has(decl.kind)) {
        const key = decl.declStart?.startOffset ?? decl.startOffset;
        indexDeclarations(decl.members || [], [...ownerChain, decl], key);
        continue;
      }
      if (decl.kind === 'function' && decl.name) indexScope(scopeKey, decl);
    }
  }
  indexDeclarations(unit.declarations, [], 'topLevel');

  // Walk again for call extraction inside measurable bodies.
  function walk(decl, ownerChain) {
    if (TYPE_KINDS_CALL.has(decl.kind)) {
      for (const member of decl.members || []) walk(member, [...ownerChain, decl]);
      return;
    }
    if (!['function', 'constructor', 'init'].includes(decl.kind)) {
      if (decl.kind === 'property') {
        for (const accessor of decl.accessors || []) {
          extractFromBody(accessor.bodyTokens || [], ownerChain, decl);
        }
        if ((decl.bodyTokens || []).length) extractFromBody(decl.bodyTokens, ownerChain, decl);
      }
      return;
    }
    extractFromBody(decl.bodyTokens || [], ownerChain, decl);
  }

  function extractFromBody(tokens, ownerChain, callerDecl) {
    if (!tokens.length) return;
    const nested = extractNestedDeclarations(tokens);
    const coveredBy = coveredChecker(nested.covered);
    for (const site of scanCallSites(tokens, coveredBy)) {
      const call = {
        file: unit.file, line: site.line, column: site.column,
        endLine: site.endLine, endColumn: site.endColumn,
        resolution: 'unresolved', reason: 'unsupported-callee',
      };
      if (!site.qualified) bindCall(call, site, ownerChain, callerDecl);
      calls.push(call);
    }
    for (const nestedDecl of nested.declarations) walk(nestedDecl, [...ownerChain, { kind: '<locals>', name: '<locals>' }]);
  }

  function bindCall(call, site, ownerChain, callerDecl) {
    call.reason = 'no-local-function-binding';
    // Type parameters and same-named local declarations shadow only inside the
    // extent that introduces them; a shadowed call never binds outward.
    if ((described.shadowedScopes || []).some(scope => scope.name === site.name
      && scope.startOffset <= site.startOffset && scope.endOffset >= site.startOffset)) return;
    // Explicit import of this simple name wins over scope candidates; imported
    // targets are outside this lexical model.
    const imported = unit.imports.find(i => !i.wildcard && (i.alias || i.name.split('.').at(-1)) === site.name);
    if (imported) return;
    // Classifier names are constructor-like positions, not function calls.
    if (described.types.some(t => t.name === site.name)) return;
    // Determine the caller scope: inside exactly one class/object with no
    // explicit supertypes, or top level. Companion objects count as objects.
    const types = ownerChain.filter(d => TYPE_KINDS_CALL.has(d.kind));
    let scopeKey = null;
    if (!types.length) {
      scopeKey = 'topLevel';
    } else if (types.length === 1) {
      const owner = types[0];
      if ((owner.supertypes || []).length || owner.kind === 'interface' || owner.kind === 'annotation') return;
      if ((ownerChain.some(d => d.kind === '<locals>'))) return;
      scopeKey = owner.declStart?.startOffset ?? owner.startOffset;
    } else {
      return;
    }
    if (scopeKey == null) return;
    const candidates = (scopeFunctions.get(scopeKey) || []).filter(decl => decl.name === site.name && decl !== callerDecl);
    if (!candidates.length) return;
    if (candidates.some(decl => (decl.parameters || []).some(p => p.vararg || p.hasDefault))) return;
    if (site.arity === null) return;
    const arityMatches = candidates.filter(decl => (decl.parameters || []).length === site.arity);
    if (arityMatches.length !== 1) {
      if (arityMatches.length > 1) call.reason = 'ambiguous-binding';
      return;
    }
    const target = arityMatches[0];
    if (!target.bodyKind || target.bodyKind === 'none') return;
    call.resolution = 'kotlin-scope-function';
    call.target = {
      name: target.name,
      line: target.declStart?.startLine ?? target.startLine,
      column: target.declStart?.startColumn ?? target.startColumn,
    };
    delete call.reason;
  }

  for (const decl of unit.declarations) walk(decl, []);
  calls.sort((a, b) => a.line - b.line || a.column - b.column || a.endLine - b.endLine || a.endColumn - b.endColumn);
  return calls;
}
