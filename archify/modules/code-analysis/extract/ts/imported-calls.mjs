// Resolve direct named exports and default function declarations/references through
// already captured static imports, including configured in-project aliases.
// The Program remains noResolve; module resolution has already selected and
// captured the target. Never infer an alias from the spelling of a specifier.
import ts from 'typescript';

const exported = (node, name) => node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
  && node.modifiers.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword) === (name === 'default');

export function importedCallTarget(node, source, checker, importTargets, sources) {
  const declarations = checker.getSymbolAtLocation(node.expression)?.declarations || [];
  if (declarations.length !== 1) return null;
  const binding = declarations[0];
  let clause, name;
  if (ts.isImportSpecifier(binding) && !binding.isTypeOnly) {
    clause = binding.parent.parent;
    name = (binding.propertyName || binding.name).text;
  } else if (ts.isImportClause(binding) && binding.name) {
    clause = binding;
    name = 'default';
  } else return null;
  const statement = clause.parent;
  if (!ts.isImportDeclaration(statement) || statement.getSourceFile() !== source
    || clause.isTypeOnly) return null;
  const specifier = statement.moduleSpecifier;
  if (!ts.isStringLiteral(specifier)) return null;
  const file = importTargets.get(statement);
  const info = sources.get(file);
  if (!info?.valid || info.source === source) return null;
  const moduleSymbol = checker.getSymbolAtLocation(info.source);
  if (!moduleSymbol) return null;
  // This is the module's explicit export symbol, not a text-name search among
  // functions. Re-export aliases and declarations in other files are rejected.
  const symbol = checker.getExportsOfModule(moduleSymbol).find((s) => s.name === name);
  const exportedDeclarations = symbol?.declarations || [];
  if (!exportedDeclarations.length || exportedDeclarations.some((d) => d.getSourceFile() !== info.source)) return null;
  let target;
  if (exportedDeclarations.every((d) => ts.isFunctionDeclaration(d) && d.parent === info.source && exported(d, name))) {
    const bodies = exportedDeclarations.filter((d) => d.body);
    if (bodies.length === 1) [target] = bodies;
  } else if (name === 'default' && exportedDeclarations.length === 1) {
    target = referencedDefaultFunction(exportedDeclarations[0], info, checker);
  } else if (name !== 'default' && exportedDeclarations.length === 1) {
    const declaration = exportedDeclarations[0];
    if (ts.isVariableDeclaration(declaration) && ts.isIdentifier(declaration.name)
      && ts.isVariableDeclarationList(declaration.parent) && (declaration.parent.flags & ts.NodeFlags.Const)) {
      const variableStatement = declaration.parent.parent;
      const init = declaration.initializer;
      if (ts.isVariableStatement(variableStatement) && variableStatement.parent === info.source && exported(variableStatement, name)
        && init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) target = init;
    }
  }
  const measured = info.functionRecords.get(target);
  if (!measured) return null;
  const start = info.source.getLineAndCharacterOfPosition(target.getStart(info.source));
  return { file, name: measured.name, line: start.line + 1, column: start.character + 1 };
}

// ESM default expressions snapshot a value; local export specifiers expose a
// binding. Accept only an ordinary captured function with no observed writes,
// so neither form guesses through reassignment, factories or re-export chains.
function referencedDefaultFunction(declaration, info, checker) {
  let symbol;
  if (ts.isExportAssignment(declaration) && !declaration.isExportEquals
    && declaration.parent === info.source && ts.isIdentifier(declaration.expression)) {
    symbol = checker.getSymbolAtLocation(declaration.expression);
  } else if (ts.isExportSpecifier(declaration) && !declaration.isTypeOnly) {
    const statement = declaration.parent.parent;
    if (!ts.isExportDeclaration(statement) || statement.parent !== info.source
      || statement.moduleSpecifier || statement.isTypeOnly) return null;
    symbol = checker.getExportSpecifierLocalTargetSymbol(declaration);
  }
  const declarations = symbol?.declarations || [];
  const functions = declarations.filter(ts.isFunctionDeclaration);
  // JS function properties add receiver identifiers to the compiler symbol's
  // declarations. They mutate properties, not the callable binding itself.
  const expando = node => ts.isIdentifier(node) && node.getSourceFile() === info.source
    && (ts.isPropertyAccessExpression(node.parent) || ts.isElementAccessExpression(node.parent))
    && node.parent.expression === node;
  if (!functions.length || declarations.some(node => !expando(node)
    && (!ts.isFunctionDeclaration(node) || node.parent !== info.source || !node.name))) return null;
  const bodies = functions.filter(node => node.body);
  if (bodies.length !== 1) return null;
  info.referenceEffects ||= referenceEffects(info.source, checker);
  if (info.referenceEffects.opaque || info.referenceEffects.writes.has(symbol)) return null;
  return bodies[0];
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
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'eval') opaque = true;
    ts.forEachChild(node, walk);
  };
  walk(source); return { writes, opaque };
}
