// Reduction of parsed Kotlin units into declaration indexes and type
// references. Kotlin shapes this reduction: constructors are ordinary-looking
// invocations, imports can carry aliases and target members directly, nested
// classifiers are never inherited (unlike Java), objects are singletons, and
// typealiases declare substitutable names. Uncertain names are left
// unresolved rather than guessed.
import { extractNestedDeclarations, coveredChecker, scanTypeEvidence } from './bodies.mjs';

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

  // Conservative shadow set: every type parameter in the file, exactly the
  // Java adapter's policy. Type parameters never denote analyzed types.
  const collectTypeParameters = decls => {
    for (const decl of decls) {
      for (const name of decl.typeParameters || []) shadowed.add(name);
      if (decl.members) collectTypeParameters(decl.members);
    }
  };
  collectTypeParameters(declarations);

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

  function harvestNestedBodies(decl, owners) {
    if (!(decl.bodyTokens || []).length) return;
    const evidence = evidenceOf(decl);
    for (const ref of evidence.typeReferences) addReference(ref);
    for (const nestedDecl of evidence.nested) harvest(nestedDecl, [...owners, '<locals>'], true);
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
    packageName, imports, types, references, shadowed, uncertainScopes, topLevel,
    declarations, file: unit.file, evidenceOf,
  };
}
