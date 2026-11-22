// Keep TypeScript's source order without spending the JS call stack on AST depth.
export function syntaxChildren(ts, node) {
  const children = [];
  ts.forEachChild(node, child => { children.push(child); });
  return children;
}

export function* syntaxNodes(ts, root) {
  const pending = [root];
  while (pending.length) {
    const node = pending.pop();
    yield node;
    const children = syntaxChildren(ts, node);
    for (let i = children.length - 1; i >= 0; i -= 1) pending.push(children[i]);
  }
}
