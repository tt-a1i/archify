// Function-level measurements for JS/TS, aligned with the Python extractor so
// the same thresholds mean the same thing in both languages.
//
// Cyclomatic complexity: 1 for the function, +1 for each if (else-if included),
// conditional expression, for / for-in / for-of / while / do loop, catch clause,
// non-default switch case, and each &&, ||, ?? (and &&=, ||=, ??=). Optional
// chaining is not counted: it guards a value rather than choosing a path a
// reader has to follow.
// Nesting: the deepest stack of if / loop / switch / try / with blocks inside the
// body. An `else if` stays at its `if`'s depth, and a catch block at its try's,
// matching Python's elif and except.
//
// What is a function: declarations, methods, constructors, accessors, and
// function or arrow expressions that receive a name (a variable, an object
// property, a class field, an assignment target, export default). Anonymous
// callbacks belong to the function that contains them, like Python lambdas. An
// anonymous callback at module scope has no such function and is measured on
// its own, named after the call it is passed to and its first literal argument,
// so top-level handlers such as `server.on('request', (req, res) => { … })` are
// not lost (`<callback of server.on("request")>`). Only callbacks with the same
// call and literal get a `#2`, `#3` suffix in source order.
// Overload signatures and other bodiless declarations are skipped.
import bundledTs from 'typescript';
import { createHash } from 'node:crypto';
import { syntaxChildren } from './syntax-walk.mjs';

export function functionTools(ts) {

const LOGICAL = new Set([
  ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken, ts.SyntaxKind.BarBarEqualsToken, ts.SyntaxKind.QuestionQuestionEqualsToken,
]);

function isShortCircuitExpression(node) {
  return ts.isBinaryExpression(node) && LOGICAL.has(node.operatorToken.kind);
}

function measureFunctions(source, file, onFunction) {
  const records = [];
  const seen = new Map(); // qualname -> count, for anonymous names that repeat

  const pending = [{ node: source, prefix: '', insideFunction: false }];
  while (pending.length) {
    let { node, prefix, insideFunction } = pending.pop();
    if (isFunctionWithBody(node)) {
      const name = functionName(node, source);
      if (name || !insideFunction) {
        let qualname = prefix + (name || anonymousName(node, source));
        if (!name) {
          const n = (seen.get(qualname) || 0) + 1;
          seen.set(qualname, n);
          if (n > 1) qualname += `#${n}`;
        }
        const measured = record(node, source, file, name || qualname.slice(prefix.length), qualname);
        records.push(measured);
        onFunction?.(measured, node);
        prefix = `${qualname}.<locals>.`;
        insideFunction = true;
      }
    } else if (ts.isClassLike(node)) {
      const className = node.name ? node.name.text : bindingName(node, source);
      if (className) prefix = `${prefix}${className}.`;
    } else if (ts.isObjectLiteralExpression(node)) {
      const owner = bindingName(node, source);
      if (owner) prefix = `${prefix}${owner}.`;
    }
    const children = syntaxChildren(ts, node);
    for (let i = children.length - 1; i >= 0; i -= 1) pending.push({ node: children[i], prefix, insideFunction });
  }
  return records.sort((a, b) => a.line - b.line || (a.qualname < b.qualname ? -1 : a.qualname > b.qualname ? 1 : 0));
}

function isFunctionWithBody(node) {
  return (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)
    || ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node))
    && Boolean(node.body);
}

function record(fn, source, file, name, qualname) {
  const m = measure(fn, source);
  const start = fn.getStart(source), end = fn.getEnd();
  const startPoint = source.getLineAndCharacterOfPosition(start);
  const endPoint = source.getLineAndCharacterOfPosition(end);
  return {
    file, name, qualname,
    syntaxKind: ts.SyntaxKind[fn.kind],
    line: startPoint.line + 1,
    endLine: endPoint.line + 1,
    sourceRange: { line: startPoint.line + 1, column: startPoint.character + 1,
      endLine: endPoint.line + 1, endColumn: endPoint.character + 1,
      sha256: createHash('sha256').update(source.text.slice(start, end)).digest('hex') },
    complexity: m.complexity, nesting: m.nesting, deepestLine: m.deepestLine,
  };
}

function measure(fn, source) {
  const state = { complexity: 1, nesting: 0, deepestLine: lineOf(source, fn.getStart(source)) };
  const pending = syntaxChildren(ts, fn).reverse().map(node => ({ node, parent: fn, depth: 0 }));
  while (pending.length) {
    const { node: child, parent, depth } = pending.pop();
    // Separately measured functions and classes do not add to this one.
    if ((isFunctionWithBody(child) && (functionName(child, source) !== null)) || ts.isClassLike(child)) continue;
    if (ts.isIfStatement(child) || ts.isConditionalExpression(child) || ts.isCatchClause(child)
      || ts.isForStatement(child) || ts.isForInStatement(child) || ts.isForOfStatement(child)
      || ts.isWhileStatement(child) || ts.isDoStatement(child) || ts.isCaseClause(child)) state.complexity += 1;
    else if (isShortCircuitExpression(child)) state.complexity += 1;
    let childDepth = depth;
    if (isBlock(child)) {
      const elseIf = ts.isIfStatement(child) && ts.isIfStatement(parent) && parent.elseStatement === child;
      childDepth = elseIf ? depth : depth + 1;
      if (childDepth > state.nesting) {
        state.nesting = childDepth;
        state.deepestLine = lineOf(source, child.getStart(source));
      }
    }
    const children = syntaxChildren(ts, child);
    for (let i = children.length - 1; i >= 0; i -= 1) pending.push({ node: children[i], parent: child, depth: childDepth });
  }
  return state;
}

function isBlock(node) {
  return ts.isIfStatement(node) || ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node)
    || ts.isWhileStatement(node) || ts.isDoStatement(node) || ts.isSwitchStatement(node) || ts.isTryStatement(node)
    || node.kind === ts.SyntaxKind.WithStatement;
}

// The name a function is known by, or null for an anonymous callback.
function functionName(fn, source) {
  if (ts.isConstructorDeclaration(fn)) return 'constructor';
  if ((ts.isFunctionDeclaration(fn) || ts.isFunctionExpression(fn)) && fn.name) return fn.name.text;
  if (ts.isMethodDeclaration(fn) || ts.isGetAccessorDeclaration(fn) || ts.isSetAccessorDeclaration(fn)) {
    const base = propertyName(fn.name, source);
    return ts.isGetAccessorDeclaration(fn) ? `get ${base}` : ts.isSetAccessorDeclaration(fn) ? `set ${base}` : base;
  }
  if (ts.isFunctionDeclaration(fn)) return 'default'; // export default function () {}
  return bindingName(fn, source);
}

// The name an expression is bound to by its parent, if any.
function bindingName(node, source) {
  let current = node;
  while (current.parent && (ts.isParenthesizedExpression(current.parent) || ts.isAsExpression(current.parent) || ts.isSatisfiesExpression?.(current.parent) || ts.isTypeAssertionExpression(current.parent))) current = current.parent;
  const parent = current.parent;
  if (!parent) return null;
  if (ts.isVariableDeclaration(parent) && parent.initializer === current && ts.isIdentifier(parent.name)) return parent.name.text;
  if ((ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent)) && parent.initializer === current) return propertyName(parent.name, source);
  if (ts.isBinaryExpression(parent) && parent.right === current && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    const left = parent.left;
    if (ts.isIdentifier(left)) return left.text;
    if (ts.isPropertyAccessExpression(left)) return left.name.text;
  }
  if (ts.isExportAssignment(parent)) return 'default';
  return null;
}

function propertyName(name, source) {
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return name.getText(source);
}

// "callback of server.on" for a module-scope callback; plain "anonymous" otherwise.
function anonymousName(fn, source) {
  let current = fn;
  while (current.parent && ts.isParenthesizedExpression(current.parent)) current = current.parent;
  const parent = current.parent;
  if (parent && ts.isCallExpression(parent) && parent.arguments.includes(current)) {
    const callee = calleeName(parent.expression, source);
    // The first literal argument (an event or route name) tells sibling registrations
    // apart by what they are, not by their position, so adding or removing one callback
    // does not rename the others: `server.on('request', …)` and `server.on('close', …)`.
    const key = parent.arguments.find((arg) => arg !== current && isLiteralKey(arg));
    const label = key ? `${callee}(${literalText(key)})` : callee;
    return `<callback of ${label.length > 60 ? `${label.slice(0, 59)}…` : label}>`;
  }
  return '<anonymous>';
}

function isLiteralKey(node) {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isNumericLiteral(node);
}

function literalText(node) {
  const text = ts.isNumericLiteral(node) ? node.text : JSON.stringify(node.text);
  return text.length > 40 ? `${text.slice(0, 39)}…` : text;
}

// `server.on`, `runCheck(…).then`: the called name without its arguments.
function calleeName(expr, source) {
  if (ts.isIdentifier(expr) || ts.isPrivateIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) return `${calleeName(expr.expression, source)}.${expr.name.text}`;
  if (ts.isCallExpression(expr)) return `${calleeName(expr.expression, source)}(…)`;
  if (expr.kind === ts.SyntaxKind.ThisKeyword) return 'this';
  return expr.getText(source).replace(/\s+/g, '').slice(0, 20);
}

function lineOf(source, pos) {
  return source.getLineAndCharacterOfPosition(pos).line + 1;
}

return { isShortCircuitExpression, measureFunctions };
}

// Historical source queries still use the bundled parser for saved v1-v5 facts.
export const { measureFunctions } = functionTools(bundledTs);
