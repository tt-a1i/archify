// Reduction of parsed Kotlin units into declaration indexes and type
// references. Kotlin shapes this reduction: constructors are ordinary-looking
// invocations, imports can carry aliases and target members directly, nested
// classifiers are never inherited (unlike Java), objects are singletons, and
// typealiases declare substitutable names. Uncertain names are left
// unresolved rather than guessed.
import { extractNestedDeclarations, coveredChecker, scanTypeEvidence, containingBlockEnd } from './bodies.mjs';

const TYPE_KINDS = new Set(['class', 'interface', 'object', 'enum', 'annotation', 'typealias']);

// describeUnit harvests, for one parsed file:
//   types       — indexed classifiers/typealiases with full names and scopes
//   references  — every type reference position, declaration and statement level
//   shadowed    — names that can never denote a project type in this file
//   uncertainScopes — ranges where local types make references uncertain
//   topLevel    — top-level function/property names for member-import resolution
//   nestedIndex — sub-parsed local declarations per owner body, for calls
export function describeUnit(unit) {
  const { packageName, imports, declarations } = unit;
  const types = [];
  const references = [];
  const shadowed = new Set();
  const uncertainScopes = [];
  const topLevel = { functions: new Map(), properties: new Map() };
  const bodyEvidence = new Map();

  const addReference = (reference, extra = {}) => {
    references.push({
      name: reference.name,
      line: reference.line ?? reference.startLine,
      startOffset: reference.startOffset,
      endOffset: reference.endOffset,
      startColumn: reference.startColumn,
      endColumn: reference.endColumn,
      ...extra,
    });
  };

  // Scoped shadowing: a type parameter shadows project classifiers only inside
  // the declaration that introduces it. `fun <T> id(x: T)` in one function must
  // not suppress a `class T` reference in an unrelated function of the file.
  const shadowedScopes = [];
  const collectTypeParameterScopes = (decls) => {
    for (const decl of decls) {
      const startOffset = decl.declStart?.startOffset ?? decl.startOffset;
      const endOffset = decl.declEnd?.endOffset ?? decl.endOffset;
      for (const name of decl.typeParameters || []) {
        shadowed.add(name);
        shadowedScopes.push({ name, startOffset, endOffset });
      }
      if (decl.members) collectTypeParameterScopes(decl.members);
    }
  };
  collectTypeParameterScopes(declarations);

  // Scan one executable body once; reuse the evidence for dependency,
  // complexity and call stages. Keyed by declaration object identity.
  function evidenceOf(decl) {
    if (bodyEvidence.has(decl)) return bodyEvidence.get(decl);
    const tokens = decl.bodyTokens || [];
    const nested = extractNestedDeclarations(tokens);
    const coveredBy = coveredChecker(nested.covered);
    const evidence = {
      nested: nested.declarations,
      covered: nested.covered,
      coveredBy,
      typeReferences: scanTypeEvidence(tokens, coveredBy, []),
    };
    bodyEvidence.set(decl, evidence);
    return evidence;
  }

  // Harvest declaration-level type positions recursively. `local` marks
  // declarations inside bodies: indexed nowhere, but their own type positions
  // still reference project types.
  function harvest(decl, owners, local) {
    if (TYPE_KINDS.has(decl.kind)) {
      if (!local && decl.name) {
        const fullName = [packageName, ...owners, decl.name].filter(Boolean).join('.');
        // Member evidence for member-import verification: direct member names
        // plus the members of a companion object, which are reachable through
        // the owner's name in Kotlin.
        const memberNames = new Set();
        for (const member of decl.members || []) {
          if (member.name) memberNames.add(member.name);
          if (member.kind === 'object' && member.companion) {
            for (const inner of member.members || []) if (inner.name) memberNames.add(inner.name);
          }
        }
        // Enum entries are reachable through the enum type name exactly like
        // members: import pkg.Mode.ACTIVE binds to Mode.
        for (const entry of decl.enumEntries || []) memberNames.add(entry);
        types.push({
          name: decl.name, fullName, file: unit.file, owners: [...owners],
          kind: decl.kind, modifiers: decl.modifiers || [],
          startOffset: decl.declStart?.startOffset ?? decl.startOffset,
          endOffset: decl.declEnd?.endOffset ?? decl.endOffset,
          line: decl.declStart?.startLine ?? decl.startLine,
          column: decl.declStart?.startColumn ?? decl.startColumn,
          memberScopeStartOffset: decl.bodyRange?.open?.startOffset ?? (decl.declStart?.startOffset ?? decl.startOffset),
          typeParameters: decl.typeParameters || [],
          companion: Boolean(decl.companion),
          memberNames: [...memberNames],
        });
      }
      if (local && decl.name) {
        shadowed.add(decl.name);
        uncertainScopes.push({
          startOffset: decl.declStart?.startOffset ?? decl.startOffset,
          endOffset: decl.declEnd?.endOffset ?? decl.endOffset,
        });
      }
      for (const ref of decl.supertypes || []) addReference(ref);
      for (const ref of decl.typeBounds || []) addReference(ref);
      for (const ref of decl.annotations || []) addReference(ref);
      for (const ref of decl.primaryConstructor?.typeReferences || []) addReference(ref);
      if (decl.kind === 'typealias') for (const ref of decl.aliasedReferences || []) addReference(ref);
      const nestedOwners = decl.name ? [...owners, decl.name] : owners;
      for (const member of decl.members || []) harvest(member, nestedOwners, local);
      return;
    }
    if (decl.kind === 'function' || decl.kind === 'constructor' || decl.kind === 'init') {
      for (const ref of decl.parameterTypeReferences || []) addReference(ref);
      for (const ref of decl.returnReferences || []) addReference(ref);
      for (const ref of decl.typeBounds || []) addReference(ref);
      for (const ref of decl.annotations || []) addReference(ref);
      if (decl.receiverReference) addReference(decl.receiverReference);
      harvestNestedBodies(decl, owners);
      return;
    }
    if (decl.kind === 'property') {
      for (const ref of decl.typeReferences || []) addReference(ref);
      for (const ref of decl.annotations || []) addReference(ref);
      if (decl.receiverReference) addReference(decl.receiverReference);
      harvestNestedBodies(decl, owners);
      for (const accessor of decl.accessors || []) {
        harvestAccessor(accessor, owners);
      }
    }
  }

  function harvestAccessor(accessor, owners) {
    if (!accessor.bodyTokens?.length) return;
    const nested = extractNestedDeclarations(accessor.bodyTokens);
    const coveredBy = coveredChecker(nested.covered);
    for (const ref of scanTypeEvidence(accessor.bodyTokens, coveredBy, [])) addReference(ref);
    for (const declaration of nested.declarations) harvest(declaration, [...owners, '<locals>'], true);
  }

  // Value visibility is positional. Parameters stay visible through the whole
  // body; a local property is visible from its declaration to the end of its
  // containing block only — a `val` inside an if branch must not suppress a
  // constructor reference outside that branch.
  function valueScopesIn(decl, evidence) {
    const scopes = [];
    const bodyStart = decl.bodyTokens?.[0]?.startOffset ?? decl.declStart?.startOffset ?? 0;
    const bodyEnd = decl.bodyTokens?.at(-1)?.endOffset ?? decl.declEnd?.endOffset ?? Number.MAX_SAFE_INTEGER;
    for (const param of decl.parameters || []) {
      if (param.name) scopes.push({ name: param.name, startOffset: bodyStart, endOffset: bodyEnd });
    }
    for (const nestedDecl of evidence?.nested || []) {
      if (nestedDecl.kind !== 'property' || !nestedDecl.name) continue;
      const start = nestedDecl.declStart?.startOffset ?? nestedDecl.startOffset;
      scopes.push({
        name: nestedDecl.name,
        startOffset: start,
        endOffset: containingBlockEnd(decl.bodyTokens || [], start, bodyEnd),
      });
    }
    return scopes;
  }

  const inScope = (scopes, name, offset) => scopes
    .some(scope => scope.name === name && scope.startOffset <= offset && scope.endOffset >= offset);

  function harvestNestedBodies(decl, owners) {
    if (!(decl.bodyTokens || []).length) return;
    const evidence = evidenceOf(decl);
    const values = valueScopesIn(decl, evidence);
    const bodyEnd = decl.bodyTokens.at(-1)?.endOffset ?? decl.declEnd?.endOffset ?? 0;
    for (const ref of evidence.typeReferences) {
      // A construction candidate whose name — or whose qualified path's first
      // segment — is a value in scope at the reference offset is an invocation
      // of that value, never a constructor reference: p.Widget() with a value
      // p in scope calls a method on p.
      if (ref.construction && inScope(values, ref.name.split('.')[0], ref.startOffset)) continue;
      addReference(ref);
    }
    for (const nestedDecl of evidence.nested) {
      // A local function shadows same-named outer functions inside the whole
      // enclosing body, exactly where its calls would bind.
      if (nestedDecl.kind === 'function' && nestedDecl.name) {
        shadowedScopes.push({
          name: nestedDecl.name,
          startOffset: decl.declStart?.startOffset ?? decl.startOffset,
          endOffset: decl.declEnd?.endOffset ?? decl.endOffset,
        });
      }
      // A local classifier shadows same-named project classifiers from its
      // declaration point to the end of its containing block. References
      // inside that range stay unbound rather than leaking to another file.
      if (['class', 'interface', 'object', 'enum', 'annotation'].includes(nestedDecl.kind) && nestedDecl.name) {
        const start = nestedDecl.declStart?.startOffset ?? nestedDecl.startOffset;
        shadowedScopes.push({
          name: nestedDecl.name,
          startOffset: start,
          endOffset: containingBlockEnd(decl.bodyTokens, start, bodyEnd),
        });
      }
      harvest(nestedDecl, [...owners, '<locals>'], true);
    }
  }

  for (const decl of declarations) {
    harvest(decl, [], false);
    if (decl.kind === 'function' && decl.name) {
      topLevel.functions.set(decl.name, (topLevel.functions.get(decl.name) || 0) + 1);
    }
    if (decl.kind === 'property' && decl.name) {
      topLevel.properties.set(decl.name, (topLevel.properties.get(decl.name) || 0) + 1);
    }
  }

  // Mark references inside uncertain scopes so resolution leaves them unknown.
  for (const ref of references) {
    ref.uncertain = uncertainScopes.some(scope => scope.startOffset <= ref.startOffset && scope.endOffset >= ref.endOffset);
  }

  return {
    packageName, imports, types, references, shadowed, shadowedScopes, uncertainScopes, topLevel,
    declarations, file: unit.file, evidenceOf,
  };
}
