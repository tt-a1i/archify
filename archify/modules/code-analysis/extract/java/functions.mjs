import { children, descendants, tokensOf, TYPE_DECLARATIONS, typeName } from './parse.mjs';

const FUNCTIONS = new Set(['methodDeclaration', 'interfaceMethodDeclaration', 'constructorDeclaration', 'compactConstructorDeclaration']);
const LOOPS = new Set(['basicForStatement', 'enhancedForStatement', 'whileStatement', 'doStatement']);
const BLOCKS = new Set([...LOOPS, 'ifStatement', 'switchStatement', 'switchExpression', 'tryStatement', 'synchronizedStatement']);

// Same scale as the existing adapters: base 1, then if/loop/catch/ternary,
// non-default case labels, pattern guards and &&/||. Else-if stays at the
// first if's depth; catches/finally stay at their try's depth. Lambdas belong
// to their containing method, while local/anonymous class methods do not.
export function measureFunctions(unit) {
  const records = [];
  const anonymousCounts = new Map();
  const initializerCounts = new Map();
  const walk = (node, owners = [], ownerNode = null) => {
    // Code outside any method is measured on its own, as module-level callbacks
    // are by the JS/TS adapter: initializer blocks by kind (`#2` for repeats),
    // and a field whose initializer contains a lambda under the field's name.
    if (node.name === 'staticInitializer' || node.name === 'instanceInitializer') {
      const kind = node.name === 'staticInitializer' ? '<static initializer>' : '<instance initializer>';
      const key = [...owners, kind].join('.');
      const count = (initializerCounts.get(key) || 0) + 1;
      initializerCounts.set(key, count);
      const name = count > 1 ? `${kind}#${count}` : kind;
      const body = node.children.block[0];
      records.push({ file: unit.file, name, qualname: [...owners, name].join('.'), line: node.location.startLine, endLine: node.location.endLine, ...measure(body, node.location.startLine) });
      for (const child of children(body)) walk(child, [...owners, name, '<locals>'], ownerNode);
      return;
    }
    if (node.name === 'fieldDeclaration' || node.name === 'constantDeclaration') {
      for (const declarator of node.children.variableDeclaratorList?.[0]?.children.variableDeclarator || []) {
        const initializer = declarator.children.variableInitializer?.[0];
        if (!initializer || !containsLambda(initializer)) continue;
        const name = declarator.children.variableDeclaratorId[0].children.Identifier[0].image;
        records.push({ file: unit.file, name, qualname: [...owners, name].join('.'), line: declarator.location.startLine, endLine: declarator.location.endLine, ...measure(initializer, declarator.location.startLine) });
      }
    }
    if (node.name === 'enumConstant' && node.children.classBody) owners = [...owners, node.children.Identifier[0].image];
    if (TYPE_DECLARATIONS.has(node.name)) {
      owners = [...owners, typeName(node)];
      ownerNode = node;
    }
    if (node.name === 'unqualifiedClassInstanceCreationExpression' && node.children.classBody) {
      const key = owners.join('.');
      const count = (anonymousCounts.get(key) || 0) + 1;
      anonymousCounts.set(key, count);
      for (const child of children(node)) walk(child, child.name === 'classBody' ? [...owners, `<anonymous#${count}>`] : owners, ownerNode);
      return;
    }
    if (FUNCTIONS.has(node.name)) {
      const body = node.children.constructorBody?.[0] || node.children.methodBody?.[0];
      if (!body || body.children.Semicolon) return;
      const declarator = node.children.constructorDeclarator?.[0]
        || node.children.methodHeader?.[0]?.children.methodDeclarator?.[0];
      const name = declarator?.children.Identifier?.[0]?.image
        || tokensOf(node.children.simpleTypeName?.[0] || declarator.children.simpleTypeName[0])[0].image;
      const params = node.name === 'compactConstructorDeclaration' ? ownerNode.children.recordHeader[0] : declarator;
      const signature = parameterTypes(params);
      const qualname = [...owners, `${name}(${signature.join(',')})`].join('.');
      const metrics = measure(body, node.location.startLine);
      records.push({ file: unit.file, name, qualname, line: node.location.startLine, endLine: node.location.endLine, ...metrics });
      for (const child of children(body)) walk(child, [...owners, `${name}(${signature.join(',')})`, '<locals>'], ownerNode);
      return;
    }
    for (const child of children(node)) walk(child, owners, ownerNode);
  };
  walk(unit.cst);
  return records.sort((a, b) => a.line - b.line || (a.qualname < b.qualname ? -1 : a.qualname > b.qualname ? 1 : 0));
}

// Lambdas inside an anonymous or local class body belong to that class's methods.
function containsLambda(node) {
  if (node.name === 'lambdaExpression') return true;
  if (node.name === 'classBody' || TYPE_DECLARATIONS.has(node.name)) return false;
  return children(node).some(containsLambda);
}

function parameterTypes(node) {
  return [...descendants(node)].filter(n => ['variableParaRegularParameter', 'variableArityParameter', 'recordComponent'].includes(n.name)).map(param => {
    const type = param.children.unannType?.[0];
    const suffix = param.children.variableDeclaratorId?.[0]?.children.dims?.[0];
    return (type ? tokensOf(type).map(t => t.image).join('') : '?')
      + (suffix ? tokensOf(suffix).map(t => t.image).join('') : '')
      + (param.children.DotDotDot || param.children.variableArityRecordComponent ? '...' : '');
  });
}

function measure(body, startLine) {
  const state = { complexity: 1, nesting: 0, deepestLine: startLine };
  const visit = (node, depth) => {
    if (TYPE_DECLARATIONS.has(node.name) || FUNCTIONS.has(node.name) || node.name === 'classBody') return;
    if (LOOPS.has(node.name) || node.name === 'ifStatement' || node.name === 'catchClause'
      || node.name === 'guard' || (node.name === 'switchLabel' && node.children.Case)
      || (node.name === 'conditionalExpression' && node.children.QuestionMark)) state.complexity += 1;
    for (const token of Object.values(node.children).flat()) if (!token.name && ['&&', '||'].includes(token.image)) state.complexity += 1;
    const nextDepth = BLOCKS.has(node.name) ? depth + 1 : depth;
    if (nextDepth > state.nesting) {
      state.nesting = nextDepth;
      state.deepestLine = node.location.startLine;
    }
    for (const child of children(node)) {
      const elseIf = node.name === 'ifStatement' && child === node.children.statement?.[1] && child.children.ifStatement;
      visit(child, elseIf ? depth : nextDepth);
    }
  };
  visit(body, 0);
  return state;
}
