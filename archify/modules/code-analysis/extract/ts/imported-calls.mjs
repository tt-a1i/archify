// Resolve direct named exports and default function declarations through
// already captured relative imports.
// The Program remains noResolve; this never asks it to load an aliased module.
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
  if (!ts.isStringLiteral(specifier) || !/^\.\.?\//.test(specifier.text)) return null;
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
