// Follow explicit ESM bindings through already captured static import/export
// selections. The Program remains noResolve; no new files or inferred aliases.
import ts from 'typescript';

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

export function importedCallTarget(node, source, checker, importTargets, sources) {
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

function referenceEffects(source, checker) {
  const writes = new Set(); let opaque = false;
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
  const walk = node => {
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
    ts.forEachChild(node, walk);
  };
  walk(source); return { writes, opaque };
}
