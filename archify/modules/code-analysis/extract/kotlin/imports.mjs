// Kotlin dependency resolution over the captured declaration index.
//
// Kotlin classifier resolution, simplified for source-only analysis:
//   1. type parameters and local classifiers shadow (never project types)
//   2. nested classifiers of enclosing classifiers are in scope — but never
//      inherited ones: Kotlin does not inherit nested classifiers, so no
//      Java-style supertype guard is needed at all
//   3. explicit imports (the alias, when present, is the bound name)
//   4. same-package classifiers
//   5. star imports cannot be expanded without a classpath: names they might
//      supply stay external or unknown, never guessed
//
// Member imports (import pkg.Type.member or a top-level member) resolve
// through the owner type or the package member index. Objects are both types
// and values, so constructor-candidate references resolve through the same
// classifier index.
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

export function resolveImports(described, sourceSetVisible = () => true) {
  // fullName → declarations (duplicate declarations stay ambiguous)
  const index = new Map();
  for (const unit of described) {
    for (const type of unit.types) {
      if (!index.has(type.fullName)) index.set(type.fullName, []);
      index.get(type.fullName).push(type);
    }
  }
  const lookup = name => index.get(name) || [];
  const packages = new Set(described.map(unit => unit.packageName).filter(Boolean));

  // Package member index: pkg.simpleName → files declaring that top-level
  // member exactly once per file. Used for member imports only.
  const memberIndex = new Map();
  for (const unit of described) {
    if (!unit.packageName) continue;
    for (const [name, count] of [...unit.topLevel.functions, ...unit.topLevel.properties]) {
      const key = `${unit.packageName}.${name}`;
      if (!memberIndex.has(key)) memberIndex.set(key, new Map());
      memberIndex.get(key).set(unit.file, (memberIndex.get(key).get(unit.file) || 0) + count);
    }
  }

  // Is this dotted name inside the project's declared package space?
  const inProject = name => name.split('.').some((_, i, parts) => i > 0 && packages.has(parts.slice(0, i).join('.')))
    || lookup(name).length > 0;

  const typeNames = new Set(described.flatMap(unit => unit.types.map(type => type.name)));

  // Types whose member scope contains the reference, outermost first.
  function enclosingTypes(unit, ref) {
    return unit.types.filter(t => t.memberScopeStartOffset <= ref.startOffset && t.endOffset >= ref.endOffset);
  }

  // Resolve the first segment in lexical scope order, then navigate the rest
  // through nested classifiers. Returns candidate type declarations, or null
  // when the name cannot denote an analyzed type at all.
  function referenceTargets(unit, ref) {
    if (ref.uncertain) return [];
    const name = ref.name;
    const first = name.split('.')[0];
    if (unit.shadowed.has(first)) return [];

    // Nested classifiers of enclosing classifiers (never inherited: complete
    // by construction, so no ancestry analysis is needed).
    for (const scope of [...enclosingTypes(unit, ref)].reverse()) {
      const direct = lookup(`${scope.fullName}.${first}`);
      if (direct.length) {
        return name === first ? direct : lookup(`${scope.fullName}.${name}`);
      }
    }

    // Explicit imports. The bound name is the alias when present, otherwise
    // the last path segment. Conflicting imports leave the name unresolved.
    const singles = unit.imports.filter(i => !i.wildcard && (i.alias || i.name.split('.').at(-1)) === first);
    if (singles.length) {
      if (singles.length > 1) return [];
      const imported = singles[0];
      const rest = name === first ? '' : name.slice(first.length);
      // A member import binds only its exact name, never a type suffix.
      const asType = lookup(imported.name + rest);
      if (asType.length) return asType;
      // Importing a classifier nested in another: import pkg.Outer.Inner
      if (name === first) {
        // The import itself is the edge; use-sites of the imported simple
        // name resolve to the same declaration.
        return lookup(imported.name);
      }
      return lookup(imported.name + rest);
    }

    // Types declared in this file at top level.
    const own = unit.types.filter(t => !t.owners.length && t.name === first);
    if (own.length) {
      return name === first ? own : lookup([unit.packageName, name].filter(Boolean).join('.'));
    }

    // Same package.
    const inPackage = part => [unit.packageName, part].filter(Boolean).join('.');
    if (name === first) {
      const samePackage = lookup(inPackage(first));
      if (samePackage.length) return samePackage;
    } else {
      // Qualified: navigate nested classifiers through the package type, or
      // treat the whole name as a fully qualified path.
      const packageRelative = inPackage(first);
      if (lookup(packageRelative).length) return lookup(inPackage(name));
      if (index.has(inPackage(name))) return lookup(inPackage(name));
      // A fully qualified path whose first segment opens a project package
      // or matches a declaration root.
      if (inProject(name)) return lookup(name);
      return [];
    }

    // Simple name below every scope: nothing found. The reference stays
    // unresolved; the caller decides the counter from project shape.
    return [];
  }

  // Whether a name may denote an analyzed type at all (the Java adapter's
  // referenceReason, adapted: no inherited-member or external-import guards,
  // because Kotlin has neither).
  const referenceReason = (unit, name) => {
    const first = name.split('.')[0];
    if (unit.shadowed.has(first)) return null;
    const imported = unit.imports.find(i => !i.wildcard && (i.alias || i.name.split('.').at(-1)) === first);
    if (imported && !inProject(imported.name) && !unit.types.some(type => type.name === first)) return null;
    return typeNames.has(first) || inProject(name) ? 'unknown' : null;
  };

  const importReason = imp => {
    if (imp.wildcard) return (packages.has(imp.name) || inProject(imp.name)) ? 'unknown' : 'external';
    return inProject(imp.name) ? 'unknown' : 'external';
  };

  const visibleCandidates = (unit, candidates) => candidates.length === 1 && !sourceSetVisible(unit.file, candidates[0].file)
    ? [] : candidates;

  const imports = [];
  const add = (unit, specifier, line, candidates, reason) => {
    const visible = visibleCandidates(unit, candidates);
    const files = [...new Set(visible.map(t => t.file))];
    const resolved = visible.length === 1 && files.length === 1;
    if (resolved && files[0] === unit.file) return;
    if (!resolved && candidates.length) reason = 'unknown';
    if (!resolved && !reason) return;
    const record = { from: unit.file, specifier, kind: 'static', line, resolved };
    if (resolved) record.to = files[0];
    imports.push({ record, reason: resolved ? null : reason });
  };

  for (const unit of described) {
    for (const imp of unit.imports) {
      let candidates = [];
      if (!imp.wildcard) {
        candidates = lookup(imp.name);
        if (!candidates.length) {
          // Member import: import pkg.Type.member or pkg.topLevelMember.
          const split = imp.name.lastIndexOf('.');
          if (split > 0) {
            const owners = lookup(imp.name.slice(0, split));
            if (owners.length === 1) candidates = owners;
            else {
              const members = memberIndex.get(imp.name);
              if (members && members.size === 1 && [...members.values()][0] >= 1) {
                // Exactly one file declares this top-level member; treated as a
                // pseudo-candidate carrying the file rather than a type.
                const file = [...members.keys()][0];
                candidates = [{ file, memberImport: true }];
              }
            }
          }
        }
      }
      add(unit, `${imp.name}${imp.wildcard ? '.*' : ''}${imp.alias ? ` as ${imp.alias}` : ''}`, imp.line ?? imp.startLine, candidates, importReason(imp));
    }
    const seen = new Set();
    for (const ref of unit.references) {
      const key = `${ref.startOffset}:${ref.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const candidates = referenceTargets(unit, ref);
      add(unit, ref.name, ref.line, candidates, referenceReason(unit, ref.name));
    }
  }

  const unique = new Map(imports.map(entry => [JSON.stringify(entry.record), entry]));
  const entries = [...unique.values()].sort((a, b) => compare(a.record.from, b.record.from) || a.record.line - b.record.line || compare(a.record.specifier, b.record.specifier));
  const unresolved = { external: 0, outside: 0, unknown: 0, opaque: 0 };
  for (const { reason } of entries) if (reason) unresolved[reason] += 1;
  return {
    imports: entries.map(entry => entry.record), unresolved,
    resolveType: (unit, reference) => visibleCandidates(unit, referenceTargets(unit, reference)),
  };
}
