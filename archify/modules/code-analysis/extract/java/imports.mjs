import { children, descendants, TYPE_DECLARATIONS, typeName } from './parse.mjs';
const TYPE_REFERENCES = new Set(['classType', 'unannClassType', 'typeName']);
// Types declared in any block are local (JLS 14.3), including interface method
// bodies and switch-rule blocks inside field initializers.
const LOCAL_SCOPES = new Set(['methodDeclaration', 'interfaceMethodDeclaration', 'constructorDeclaration', 'compactConstructorDeclaration', 'lambdaExpression', 'instanceInitializer', 'staticInitializer', 'block']);
// No candidates: the name binds an inherited member type of an analyzed type.
const INHERITED = Object.freeze([]);
// Common JDK supertypes and the member type names a subclass inherits from
// them (public or protected, transitively). Generated from JDK 17; these types
// have had the same member types since Java 8. A body whose supertypes are all
// analyzed or listed here opens; the names they contribute stay unresolved.
const JDK_MEMBERS = new Map([
  ...['Comparable', 'Cloneable', 'AutoCloseable', 'Iterable', 'Runnable', 'Throwable', 'Exception', 'RuntimeException', 'Error',
    'IllegalArgumentException', 'IllegalStateException', 'UnsupportedOperationException'].map(name => [`java.lang.${name}`, []]),
  ...['Serializable', 'Closeable', 'IOException'].map(name => [`java.io.${name}`, []]),
  ...['Iterator', 'Collection', 'List', 'Set', 'EventListener'].map(name => [`java.util.${name}`, []]),
  ['java.util.Map', ['Entry']],
  ['java.util.concurrent.Callable', []],
]);
const BODIES = { normalClassDeclaration: 'classBody', normalInterfaceDeclaration: 'interfaceBody', enumDeclaration: 'enumBody', annotationInterfaceDeclaration: 'annotationInterfaceBody' };
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const identifiers = node => (node?.children.Identifier || []).map(t => t.image).join('.');

export function describeUnit(unit) {
  const pkg = [...descendants(unit.cst)].find(n => n.name === 'packageDeclaration');
  const packageName = identifiers(pkg);
  const types = [], shadowed = new Set(), uncertainScopes = [];
  for (const node of descendants(unit.cst)) {
    if (node.name === 'typeParameter') shadowed.add(node.children.typeIdentifier?.[0]?.children.Identifier?.[0]?.image);
  }
  const visit = (node, owners = [], local = false) => {
    if (TYPE_DECLARATIONS.has(node.name)) {
      const name = typeName(node);
      if (name) {
        // Members are in scope in the body, not in the type's own
        // extends/implements clauses or type bounds (JLS 6.3). A record's
        // members are also in scope in its header, its component list.
        const body = node.name === 'recordDeclaration' ? node.children.recordHeader?.[0]
          : node.children[BODIES[node.name]]?.[0];
        if (local) { shadowed.add(name); uncertainScopes.push(node.location); }
        else types.push({ name, fullName: [packageName, ...owners, name].filter(Boolean).join('.'), file: unit.file, owners,
          startOffset: node.location.startOffset, endOffset: node.location.endOffset,
          memberScopeStartOffset: body?.location.startOffset ?? node.location.startOffset,
          // A record's implements clause follows its header but is outside the member scope.
          scopeGap: node.name === 'recordDeclaration' ? node.children.classImplements?.[0]?.location : undefined,
          staticMembers: staticMembers(node), kind: node.name, supertypes: supertypes(node) });
        owners = [...owners, name];
      }
    }
    // Anonymous class bodies have no canonical project-wide type name.
    const anonymous = node.name === 'unqualifiedClassInstanceCreationExpression';
    for (const child of children(node)) {
      const anonymousBody = child.name === 'classBody' && (anonymous || node.name === 'enumConstant');
      if (anonymousBody) uncertainScopes.push(child.location);
      visit(child, owners, local || LOCAL_SCOPES.has(node.name) || anonymousBody);
    }
  };
  visit(unit.cst);
  const imports = [...descendants(unit.cst)].filter(n => n.name === 'importDeclaration' && n.children.packageOrTypeName).map(node => ({
    name: identifiers(node.children.packageOrTypeName[0]), wildcard: Boolean(node.children.Star),
    isStatic: Boolean(node.children.Static), line: node.location.startLine,
  }));
  const qualifiedCreations = new Set();
  const references = [];
  for (const node of descendants(unit.cst)) {
    // Pre-order: a suffix is seen before the creation it qualifies.
    if (node.name === 'primarySuffix') for (const creation of node.children.unqualifiedClassInstanceCreationExpression || []) qualifiedCreations.add(creation.children.classOrInterfaceTypeToInstantiate?.[0]);
    const use = typeUse(node, qualifiedCreations);
    if (!use?.name) continue;
    const { location } = use.node;
    references.push({
      name: use.name, line: location.startLine, startOffset: location.startOffset, endOffset: location.endOffset,
      uncertain: uncertainScopes.some(scope => scope.startOffset <= location.startOffset && scope.endOffset >= location.endOffset),
    });
  }
  return { file: unit.file, packageName, types, shadowed, imports, references };
}

// Instance creation, `Type::new` and class literals name a type syntactically.
// A qualified creation (`outer.new Inner()`) is relative to outer's type, and
// other method references may start with an expression: neither is modeled.
function typeUse(node, qualifiedCreations) {
  if (TYPE_REFERENCES.has(node.name)) return { node, name: identifiers(node) };
  if (node.name === 'classOrInterfaceTypeToInstantiate') return qualifiedCreations.has(node) ? null : { node, name: identifiers(node) };
  if (node.name !== 'primary') return null;
  const type = node.children.primaryPrefix?.[0]?.children.fqnOrRefType?.[0];
  const suffix = node.children.primarySuffix?.[0];
  if (!type || !(suffix?.children.classLiteralSuffix || suffix?.children.methodReferenceSuffix?.[0]?.children.New)) return null;
  const parts = [...(type.children.fqnOrRefTypePartFirst || []), ...(type.children.fqnOrRefTypePartRest || [])]
    .map(part => part.children.fqnOrRefTypePartCommon?.[0]?.children.Identifier?.[0]?.image);
  return parts.every(Boolean) ? { node: type, name: parts.join('.') } : null;
}

export function resolveImports(units) {
  const described = units.map(unit => unit.references ? unit : describeUnit(unit));
  const index = new Map();
  for (const unit of described) for (const type of unit.types) {
    if (!index.has(type.fullName)) index.set(type.fullName, []);
    index.get(type.fullName).push(type);
  }
  // A member type is only as certain as every type enclosing it: duplicate
  // declarations of an outer type (for example in two source sets) may
  // declare or inherit the member differently, so the member stays ambiguous.
  const lookup = name => {
    const candidates = index.get(name) || [];
    const enclosingUnique = type => type.owners.every((_, i) => index.get(type.fullName.split('.').slice(0, -(i + 1)).join('.'))?.length === 1);
    return candidates.every(enclosingUnique) ? candidates : [];
  };
  // Member type names a type inherits (JLS 8.5). `names` maps each known name
  // to whether an analyzed declaration contributes it; `complete` holds only
  // when every supertype resolves to one analyzed declaration or a listed JDK
  // type, since any other supertype may contribute any member.
  const unitOf = new Map(described.map(unit => [unit.file, unit]));
  const declaredMembers = new Map();
  for (const unit of described) for (const type of unit.types) if (type.owners.length) {
    const owner = type.fullName.slice(0, -type.name.length - 1);
    if (!declaredMembers.has(owner)) declaredMembers.set(owner, new Set());
    declaredMembers.get(owner).add(type.name);
  }
  const inherited = new Map();
  const inheritedMembers = type => {
    if (inherited.has(type)) return inherited.get(type);
    // A cyclic chain is reported as incomplete.
    inherited.set(type, { names: new Map(), complete: false });
    // Every enum implicitly extends java.lang.Enum, which declares EnumDesc.
    const names = new Map(type.kind === 'enumDeclaration' ? [['EnumDesc', false]] : []);
    const inherit = (name, analyzed) => names.set(name, names.get(name) || analyzed);
    let complete = true;
    for (const supertype of type.supertypes) {
      // A supertype name is bound in the scope of its declaration header.
      const unit = unitOf.get(type.file);
      const targets = referenceTargets(unit, supertype, supertype.name, index, lookup, inheritedMembers);
      if (targets.length !== 1) {
        const jdk = targets.length ? null : jdkSupertype(unit, supertype);
        if (jdk) for (const name of JDK_MEMBERS.get(jdk)) inherit(name, false);
        else complete = false;
        continue;
      }
      const deeper = inheritedMembers(targets[0]);
      complete &&= deeper.complete;
      for (const name of declaredMembers.get(targets[0].fullName) || []) inherit(name, true);
      for (const [name, analyzed] of deeper.names) inherit(name, analyzed);
    }
    const result = { names, complete };
    inherited.set(type, result);
    return result;
  };
  // The shared unresolved contract, as for the other adapters: `external` is
  // outside the analyzed sources (standard library, third party), `unknown` is
  // a dependency that looks internal but could not be resolved.
  const packages = new Set(described.map(unit => unit.packageName).filter(Boolean));
  // The listed JDK type an unresolved supertype name binds, or null. Only
  // positive evidence counts: a single-type import, which outranks same-package
  // and on-demand types (JLS 6.4.1), or a fully qualified name. An implicit
  // java.lang or on-demand binding is not inferred, since an unanalyzed
  // same-package source (generated, excluded or unparsable) could declare it.
  const jdkSupertype = (unit, ref) => {
    const first = ref.name.split('.')[0];
    if (unit.shadowed.has(first)) return null;
    // A member type in scope binds the name before any import.
    for (const scope of enclosingTypes(unit, ref)) {
      const { names, complete } = inheritedMembers(scope);
      if (index.has(`${scope.fullName}.${first}`) || !complete || names.has(first)) return null;
    }
    if (unit.imports.some(i => i.isStatic && !i.wildcard && i.name.split('.').at(-1) === first)) return null;
    const single = unit.imports.find(i => !i.wildcard && !i.isStatic && i.name.split('.').at(-1) === first);
    if (single) return JDK_MEMBERS.has(single.name + ref.name.slice(first.length)) ? single.name + ref.name.slice(first.length) : null;
    if (!ref.name.includes('.') || !JDK_MEMBERS.has(ref.name)) return null;
    // A type named like the first package segment would obscure the package
    // (JLS 6.4.2): one in the file or package, or one an on-demand import of an
    // unanalyzed package could contribute.
    const inPackage = part => [unit.packageName, part].filter(Boolean).join('.');
    if (unit.types.some(t => !t.owners.length && t.name === first) || index.has(inPackage(first))) return null;
    if (unit.imports.some(i => i.wildcard && (index.has(`${i.name}.${first}`) || (!packages.has(i.name) && !index.has(i.name))))) return null;
    return ref.name;
  };
  const typeNames = new Set(described.flatMap(unit => unit.types.map(type => type.name)));
  const inProject = name => name.split('.').some((_, i, parts) => i > 0 && packages.has(parts.slice(0, i).join('.')));
  const importReason = imp => (imp.wildcard ? packages.has(imp.name) || inProject(imp.name) : inProject(imp.name)) ? 'unknown' : 'external';
  // A reference is recorded only while it may denote an analyzed type. Type
  // parameters and local types are no dependency; a name bound to an external
  // import is represented by that import; other names cannot be analyzed types.
  const referenceReason = (unit, name) => {
    const first = name.split('.')[0];
    if (unit.shadowed.has(first)) return null;
    const imported = unit.imports.find(i => !i.wildcard && i.name.split('.').at(-1) === first);
    if (imported && !inProject(imported.name) && !unit.types.some(type => type.name === first)) return null;
    return typeNames.has(first) || inProject(name) ? 'unknown' : null;
  };
  const imports = [];
  const add = (unit, specifier, line, candidates, reason) => {
    const files = [...new Set(candidates.map(t => t.file))];
    // Duplicate declarations, including main/test source-set duplicates, remain
    // ambiguous even if they happen to be written in the same source file.
    const resolved = candidates.length === 1 && files.length === 1;
    if (resolved && files[0] === unit.file) return;
    // Ambiguous analyzed declarations are an internal resolution gap.
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
        if (!imp.isStatic) candidates = lookup(imp.name);
        else {
          const split = imp.name.lastIndexOf('.');
          const owners = lookup(imp.name.slice(0, split));
          // A matching member cannot disambiguate duplicate owner declarations.
          if (owners.length === 1 && owners[0].staticMembers.has(imp.name.slice(split + 1))) candidates = owners;
        }
      }
      // An on-demand declaration is not an edge to every file in a package.
      // Without a classpath we cannot exclude external/inherited competitors.
      add(unit, `${imp.name}${imp.wildcard ? '.*' : ''}`, imp.line, candidates, importReason(imp));
    }
    const seen = new Set();
    for (const ref of unit.references) {
      const { name } = ref;
      const key = `${ref.startOffset}:${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const candidates = referenceTargets(unit, ref, name, index, lookup, inheritedMembers);
      add(unit, name, ref.line, candidates, candidates === INHERITED ? 'unknown' : referenceReason(unit, name));
    }
  }
  // Several CST wrappers can refer to the same source-level type at a line.
  const unique = new Map(imports.map(entry => [JSON.stringify(entry.record), entry]));
  const entries = [...unique.values()].sort((a, b) => compare(a.record.from, b.record.from) || a.record.line - b.record.line || compare(a.record.specifier, b.record.specifier));
  const unresolved = { external: 0, outside: 0, unknown: 0, opaque: 0 };
  for (const { reason } of entries) if (reason) unresolved[reason] += 1;
  return { imports: entries.map(entry => entry.record), unresolved };
}

// Types whose member scope contains the node, outermost first.
function enclosingTypes(unit, node) {
  return unit.types.filter(t => t.memberScopeStartOffset <= node.startOffset && t.endOffset >= node.endOffset
    && !(t.scopeGap && t.scopeGap.startOffset <= node.startOffset && t.scopeGap.endOffset >= node.endOffset));
}

// `index` decides which declaration binds a name; `lookup` decides whether
// that binding is certain enough to become an edge.
function referenceTargets(unit, node, name, index, lookup, inheritedMembers) {
  if (node.uncertain) return [];
  const first = name.split('.')[0];
  if (unit.shadowed.has(first)) return [];
  const enclosing = enclosingTypes(unit, node);
  // Bind the first segment in the nearest lexical scope before looking up
  // members. A missing (possibly inherited) member must not change that
  // binding into an unrelated import or package name. An inherited member
  // type can shadow a package or imported type: an inherited match, or a
  // scope whose inherited members are unknown, leaves the name unresolved.
  for (const scope of [...enclosing].reverse()) {
    const prefix = index.get(`${scope.fullName}.${first}`) || [];
    if (prefix.length) return prefix.length === 1 ? lookup(`${scope.fullName}.${name}`) : [];
    const { names, complete } = inheritedMembers(scope);
    // An analyzed inherited member type binds the name even over an external
    // import; it stays unresolved but counts as an internal gap.
    if (names.get(first)) return INHERITED;
    if (!complete || names.has(first)) return [];
  }
  // Member types in scope shadow imports (JLS 6.4.1). Below them, a single
  // static import may name a member type and override package lookup. Its
  // declaration is recorded above; do not infer the reference's type scope.
  if (unit.imports.some(i => i.isStatic && !i.wildcard && i.name.split('.').at(-1) === first)) return [];
  const own = unit.types.filter(t => !t.owners.length && t.name === first);
  if (own.length) return name.includes('.') ? lookup(`${unit.packageName ? unit.packageName + '.' : ''}${name}`) : own;
  const singles = unit.imports.filter(i => !i.wildcard && !i.isStatic && i.name.split('.').at(-1) === first);
  if (singles.length) return singles.length === 1 ? lookup(singles[0].name + name.slice(first.length)) : [];
  const inPackage = part => [unit.packageName, part].filter(Boolean).join('.');
  // A qualified name is relative to the package only through a type declared
  // there: Java has no package names relative to the current package.
  if ((!name.includes('.') || index.has(inPackage(first))) && index.has(inPackage(name))) return lookup(inPackage(name));
  if (name.includes('.')) {
    // A project type named like the first package segment would make the
    // qualified name's meaning uncertain; do not guess its interpretation.
    if (index.has(inPackage(first))) return [];
    // So would a type imported on demand under that name, which obscures the
    // package (JLS 6.5.2); on-demand imports are not expanded.
    if (unit.imports.some(i => i.wildcard && index.has(`${i.name}.${first}`))) return [];
    return lookup(name);
  }
  return [];
}

// Supertypes named in an extends/implements clause, as references that are
// resolved later in the scope of that clause.
function supertypes(type) {
  const { classExtends = [], classImplements = [], interfaceExtends = [] } = type.children;
  const listed = [...classImplements, ...interfaceExtends].flatMap(clause => clause.children.interfaceTypeList?.[0]?.children.interfaceType || []);
  return [...classExtends, ...listed].flatMap(node => node.children.classType || [])
    .map(node => ({ name: identifiers(node), startOffset: node.location.startOffset, endOffset: node.location.endOffset }));
}

function staticMembers(type) {
  const names = new Set();
  const ownerIsInterface = type.name === 'normalInterfaceDeclaration' || type.name === 'annotationInterfaceDeclaration';
  // Member enums, records and interfaces, and every member type of an
  // interface, are implicitly static (JLS 8.5.1, 9.5); member classes need
  // the explicit modifier, which the parser attaches to the wrapping node.
  const implicitlyStatic = declaration => ownerIsInterface || declaration.name !== 'normalClassDeclaration';
  const visit = node => {
    if (node.name === 'classDeclaration' || node.name === 'interfaceDeclaration') {
      const declaration = children(node).find(child => TYPE_DECLARATIONS.has(child.name));
      const explicit = [...(node.children.classModifier || []), ...(node.children.interfaceModifier || [])].some(m => m.children.Static);
      if (declaration && (explicit || implicitlyStatic(declaration))) names.add(typeName(declaration));
      return;
    }
    // Records rewritten from a misparsed method have no wrapping node.
    if (node !== type && TYPE_DECLARATIONS.has(node.name)) {
      if (implicitlyStatic(node)) names.add(typeName(node));
      return;
    }
    if (node.name === 'methodDeclaration' || node.name === 'interfaceMethodDeclaration') {
      const declaration = [...descendants(node)].find(n => n.name === 'methodDeclarator');
      if ([...(node.children.methodModifier || []), ...(node.children.interfaceMethodModifier || [])].some(m => m.children.Static)) names.add(declaration.children.Identifier[0].image);
      return;
    }
    if (node.name === 'fieldDeclaration' || node.name === 'constantDeclaration') {
      const isStatic = node.name === 'constantDeclaration' || (node.children.fieldModifier || []).some(m => m.children.Static);
      const list = node.children.variableDeclaratorList?.[0];
      if (isStatic) for (const n of list?.children.variableDeclarator || []) names.add(n.children.variableDeclaratorId?.[0]?.children.Identifier?.[0]?.image);
      return;
    }
    if (node.name === 'enumConstant') { names.add(node.children.Identifier?.[0]?.image); return; }
    if (LOCAL_SCOPES.has(node.name)) return;
    for (const child of children(node)) visit(child);
  };
  visit(type);
  return names;
}
