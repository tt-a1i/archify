// Follow explicit ESM bindings through already captured static import/export
// selections. The Program remains noResolve; no new files or inferred aliases.
import { syntaxNodes } from './syntax-walk.mjs';

export function importedCallTools(ts) {

const exported = (node, name) => node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)
  && node.modifiers.some(m => m.kind === ts.SyntaxKind.DefaultKeyword) === (name === 'default');

function importBinding(binding, source) {
  let clause, name;
  if (ts.isImportSpecifier(binding) && !binding.isTypeOnly) {
    clause = binding.parent.parent; name = (binding.propertyName || binding.name).text;
  } else if (ts.isImportClause(binding) && binding.name) {
    clause = binding; name = 'default';
  } else return null;
  const statement = clause.parent;
  if (!ts.isImportDeclaration(statement) || statement.parent !== source || clause.isTypeOnly
    || !ts.isStringLiteral(statement.moduleSpecifier)) return null;
  return { statement, name };
}

function stable(info, checker, symbol) {
  info.referenceEffects ||= referenceEffects(info.source, checker);
  return !info.referenceEffects.opaque && (!symbol || !info.referenceEffects.writes.has(symbol));
}

// Properties can add expando identifiers to a function symbol; they do not
// replace its callable binding. Imported references and arbitrary value aliases
// are handled separately, never by a text-name search.
function referencedFunction(symbol, info, checker) {
  const declarations = symbol?.declarations || [];
  const functions = declarations.filter(ts.isFunctionDeclaration);
  const expando = node => ts.isIdentifier(node) && node.getSourceFile() === info.source
    && (ts.isPropertyAccessExpression(node.parent) || ts.isElementAccessExpression(node.parent))
    && node.parent.expression === node;
  if (!functions.length || declarations.some(node => !expando(node)
    && (!ts.isFunctionDeclaration(node) || node.parent !== info.source || !node.name))) return null;
  const bodies = functions.filter(node => node.body);
  if (bodies.length !== 1 || !stable(info, checker, checker.getSymbolAtLocation(bodies[0].name))) return null;
  return bodies[0];
}

function importedCallTarget(node, source, checker, importTargets, sources) {
  const declarations = checker.getSymbolAtLocation(node.expression)?.declarations || [];
  if (declarations.length !== 1) return null;
  let selected = importBinding(declarations[0], source);
  const visited = new Set([source]), via = [];
  while (selected) {
    const file = importTargets.get(selected.statement), info = sources.get(file);
    if (!info?.valid || visited.has(info.source)) return null;
    visited.add(info.source);
    const name = selected.name, moduleSymbol = checker.getSymbolAtLocation(info.source);
    if (!moduleSymbol) return null;
    const symbol = checker.getExportsOfModule(moduleSymbol).find(s => s.name === name);
    const exportedDeclarations = symbol?.declarations || [];
    // Wildcard-derived declarations are owned by another source file and do
    // not establish an explicit export route in this bounded model.
    if (!exportedDeclarations.length || exportedDeclarations.some(d => d.getSourceFile() !== info.source)) return null;
    let target = null, next = null;
    if (exportedDeclarations.every(d => ts.isFunctionDeclaration(d) && d.parent === info.source && exported(d, name))) {
      const bodies = exportedDeclarations.filter(d => d.body);
      if (bodies.length === 1 && stable(info, checker, bodies[0].name ? checker.getSymbolAtLocation(bodies[0].name) : null)) [target] = bodies;
    } else if (exportedDeclarations.length === 1) {
      const declaration = exportedDeclarations[0];
      let reference;
      if (ts.isExportSpecifier(declaration) && !declaration.isTypeOnly) {
        const statement = declaration.parent.parent;
        if (!ts.isExportDeclaration(statement) || statement.parent !== info.source || statement.isTypeOnly) return null;
        if (statement.moduleSpecifier) {
          if (!ts.isStringLiteral(statement.moduleSpecifier)) return null;
          next = { statement, name: (declaration.propertyName || declaration.name).text };
        } else reference = checker.getExportSpecifierLocalTargetSymbol(declaration);
      } else if (name === 'default' && ts.isExportAssignment(declaration) && !declaration.isExportEquals
        && declaration.parent === info.source && ts.isIdentifier(declaration.expression)) {
        reference = checker.getSymbolAtLocation(declaration.expression);
      } else if (name !== 'default' && ts.isVariableDeclaration(declaration) && ts.isIdentifier(declaration.name)
        && ts.isVariableDeclarationList(declaration.parent) && (declaration.parent.flags & ts.NodeFlags.Const)) {
        const statement = declaration.parent.parent, init = declaration.initializer;
        if (ts.isVariableStatement(statement) && statement.parent === info.source && exported(statement, name)
          && init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))
          && stable(info, checker, checker.getSymbolAtLocation(declaration.name))) target = init;
      }
      if (reference) {
        const local = reference.declarations || [];
        if (local.length === 1) next = importBinding(local[0], info.source);
        if (next && !stable(info, checker, reference)) return null;
        if (!next) target = referencedFunction(reference, info, checker);
      }
    }
    if (target) {
      const measured = info.functionRecords.get(target);
      if (!measured) return null;
      const start = info.source.getLineAndCharacterOfPosition(target.getStart(info.source));
      return { target: { file, name: measured.name, line: start.line + 1, column: start.character + 1 }, ...(via.length ? { via } : {}) };
    }
    if (!next || !stable(info, checker, null)) return null;
    const point = info.source.getLineAndCharacterOfPosition(next.statement.getStart(info.source));
    via.push({ file, line: point.line + 1, column: point.character + 1 });
    selected = next;
  }
  return null;
}

// CommonJS exports have mutable object identity. Attribute only a direct
// destructured require and a source whose module/exports references are all
// static top-level writes. Other aliases or later mutations stay unknown.
function commonJsCallTarget(node, source, callerFile, checker, importTargets, sources) {
  const declarations = checker.getSymbolAtLocation(node.expression)?.declarations || [];
  if (declarations.length !== 1 || !ts.isBindingElement(declarations[0])) return null;
  const binding = declarations[0], pattern = binding.parent;
  if (!ts.isObjectBindingPattern(pattern) || !ts.isIdentifier(binding.name) || binding.dotDotDotToken
    || binding.initializer || !pattern.elements.every(element => !element.dotDotDotToken)) return null;
  const name = binding.propertyName || binding.name;
  if (!ts.isIdentifier(name) && !ts.isStringLiteral(name)) return null;
  const declaration = pattern.parent, list = declaration.parent;
  if (!ts.isVariableDeclaration(declaration) || !ts.isVariableDeclarationList(list)
    || !(list.flags & ts.NodeFlags.Const) || !ts.isVariableStatement(list.parent)
    || list.parent.parent !== source || !declaration.initializer || !isRequireCall(declaration.initializer, checker)) return null;
  const file = importTargets.get(declaration.initializer), info = sources.get(file);
  if (!info?.valid || !sources.get(callerFile)?.valid || !stable(sources.get(callerFile), checker, checker.getSymbolAtLocation(node.expression))) return null;
  // A captured loader alias, dynamic load or cache access can mutate a module
  // without a static import edge. Do not attribute any CommonJS target when
  // that escape is visible in this project.
  for (const captured of sources.values()) {
    captured.referenceEffects ||= referenceEffects(captured.source, checker);
    if (captured.referenceEffects.commonJsOpaque || captured.referenceEffects.opaque) return null;
  }
  // A namespace result can expose the mutable exports object to a write or an
  // arbitrary consumer. Admit only named destructuring and side-effect loads
  // for this target throughout the captured project.
  for (const [usage, target] of importTargets) {
    if (target !== file) continue;
    if (!ts.isCallExpression(usage)) return null;
    const parent = usage.parent;
    if (ts.isExpressionStatement(parent)) continue;
    if (!ts.isVariableDeclaration(parent) || !ts.isObjectBindingPattern(parent.name)
      || !parent.name.elements.every(element => ts.isIdentifier(element.name) && !element.dotDotDotToken && !element.initializer)) return null;
  }
  const exports = commonJsExports(info.source, checker);
  const symbol = exports?.get(name.text);
  const target = referencedFunction(symbol, info, checker);
  const measured = target && info.functionRecords.get(target);
  if (!measured) return null;
  const start = info.source.getLineAndCharacterOfPosition(target.getStart(info.source));
  return { file, name: measured.name, line: start.line + 1, column: start.character + 1 };
}

function commonJsExports(source, checker) {
  const allowed = new Set(), exports = new Map();
  let wholeObject = false;
  const global = node => {
    if (!ts.isIdentifier(node)) return false;
    const declarations = checker.getSymbolAtLocation(node)?.declarations || [];
    return !declarations.length || declarations.every(declaration => declaration === source
      || (ts.isIdentifier(declaration) && declaration.text === 'module'
        && ts.isPropertyAccessExpression(declaration.parent) && declaration.parent.expression === declaration));
  };
  const moduleExports = node => ts.isPropertyAccessExpression(node) && node.name.text === 'exports'
    && global(node.expression) && node.expression.text === 'module';
  const exportRoot = node => global(node) && node.text === 'exports';
  const add = (name, value, symbol = checker.getSymbolAtLocation(value)) => {
    if (!ts.isIdentifier(value) || exports.has(name)) return false;
    exports.set(name, symbol);
    return true;
  };
  for (const statement of source.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isBinaryExpression(statement.expression)
      || statement.expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken) continue;
    const { left, right } = statement.expression;
    if (moduleExports(left)) {
      if (wholeObject || exports.size || !ts.isObjectLiteralExpression(right)) return null;
      wholeObject = true;
      allowed.add(left.expression);
      for (const property of right.properties) {
        if (ts.isShorthandPropertyAssignment(property)) {
          if (!add(property.name.text, property.name, checker.getShorthandAssignmentValueSymbol(property))) return null;
        } else if (ts.isPropertyAssignment(property) && !ts.isComputedPropertyName(property.name)
          && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) {
          if (!add(property.name.text, property.initializer)) return null;
        } else return null;
      }
    } else if (ts.isPropertyAccessExpression(left) && (moduleExports(left.expression) || exportRoot(left.expression))) {
      if (wholeObject || !add(left.name.text, right)) return null;
      allowed.add(moduleExports(left.expression) ? left.expression.expression : left.expression);
    }
  }
  let unsafe = false;
  for (const node of syntaxNodes(ts, source)) {
    if (ts.isIdentifier(node) && ['module', 'exports'].includes(node.text)
      && !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)
      && global(node) && !allowed.has(node)) unsafe = true;
  }
  return unsafe ? null : exports;
}

function referenceEffects(source, checker) {
  const writes = new Set(); let opaque = false, commonJsOpaque = false;
  const write = node => {
    if (ts.isIdentifier(node)) {
      const symbol = checker.getSymbolAtLocation(node); if (symbol) writes.add(symbol);
    } else if (ts.isParenthesizedExpression(node)) write(node.expression);
    else if (ts.isArrayLiteralExpression(node)) node.elements.forEach(write);
    else if (ts.isObjectLiteralExpression(node)) for (const property of node.properties) {
      if (ts.isShorthandPropertyAssignment(property)) {
        const symbol = checker.getShorthandAssignmentValueSymbol(property); if (symbol) writes.add(symbol);
      } else if (ts.isPropertyAssignment(property)) write(property.initializer);
      else if (ts.isSpreadAssignment(property)) write(property.expression);
    }
    else if (ts.isSpreadElement(node)) write(node.expression);
    // Property writes mutate an object, not the local function binding.
  };
  for (const node of syntaxNodes(ts, source)) {
    if (ts.isIdentifier(node) && !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)
      && isModuleRequire(node, checker)) {
      const parent = node.parent;
      const direct = ts.isCallExpression(parent) && parent.expression === node
        && parent.arguments.length === 1 && ts.isStringLiteralLike(parent.arguments[0])
        && isModuleRequire(node, checker, true);
      const declaration = ts.isVariableDeclaration(parent) && parent.name === node;
      const resolve = ts.isPropertyAccessExpression(parent) && parent.expression === node && parent.name.text === 'resolve'
        && ts.isCallExpression(parent.parent) && parent.parent.expression === parent;
      if (!direct && !declaration && !resolve) commonJsOpaque = true;
    }
    if (ts.isIdentifier(node) && node.text === 'module' && !checker.getSymbolAtLocation(node)?.declarations?.length
      && !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)
      && !(ts.isPropertyAccessExpression(node.parent) && node.parent.expression === node && node.parent.name.text === 'exports')) commonJsOpaque = true;
    if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
      && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) write(node.left);
    if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node))
      && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator)) write(node.operand);
    if ((ts.isForOfStatement(node) || ts.isForInStatement(node)) && !ts.isVariableDeclarationList(node.initializer)) write(node.initializer);
    if (ts.isCallExpression(node)) {
      let callee = node.expression;
      while (ts.isParenthesizedExpression(callee) || ts.isAsExpression(callee)
        || ts.isTypeAssertionExpression(callee) || ts.isNonNullExpression(callee)
        || ts.isSatisfiesExpression(callee)) callee = callee.expression;
      if (ts.isIdentifier(callee) && callee.text === 'eval') opaque = true;
    }
  }
  return { writes, opaque, commonJsOpaque };
}

function isRequireCall(node, checker) {
  return ts.isCallExpression(node) && ts.isIdentifier(node.expression) && isModuleRequire(node.expression, checker, true);
}

// Native CommonJS require has no source declaration. Also preserve the common
// ESM createRequire pattern, but never infer an arbitrary local function is a loader.
function isModuleRequire(identifier, checker, forDependency = false) {
  const parent = identifier.parent;
  const symbol = ts.isShorthandPropertyAssignment(parent) && parent.name === identifier
    ? checker.getShorthandAssignmentValueSymbol(parent) : checker.getSymbolAtLocation(identifier);
  const declarations = symbol?.declarations || [];
  if (!declarations.length) return identifier.text === 'require';
  if (declarations.length !== 1) return false;
  const declaration = declarations[0];
  if (!ts.isVariableDeclaration(declaration) || !declaration.initializer
    || !ts.isCallExpression(declaration.initializer)) return false;
  // Mutable aliases can still expose the require cache, but cannot establish
  // a dependency because a later call may use a replacement function.
  if (forDependency && !(declaration.parent.flags & ts.NodeFlags.Const)) return false;
  const args = declaration.initializer.arguments;
  const base = args[0];
  if (args.length !== 1 || !ts.isPropertyAccessExpression(base) || base.name.text !== 'url'
    || !ts.isMetaProperty(base.expression) || base.expression.keywordToken !== ts.SyntaxKind.ImportKeyword) return false;
  const factory = declaration.initializer.expression;
  if (!ts.isIdentifier(factory)) return false;
  const imported = checker.getSymbolAtLocation(factory)?.declarations?.[0];
  if (!imported || !ts.isImportSpecifier(imported)
    || (imported.propertyName || imported.name).text !== 'createRequire') return false;
  const statement = imported.parent.parent.parent;
  return ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)
    && ['node:module', 'module'].includes(statement.moduleSpecifier.text);
}

return { importedCallTarget, commonJsCallTarget, isRequireCall };
}
