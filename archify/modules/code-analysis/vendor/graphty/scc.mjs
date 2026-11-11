// SPDX-License-Identifier: MIT
// Copyright (c) 2025 Adam Powers
// Derived from @graphty/algorithms 3.4.14, 909fda2c702c9d802d24ce9dcc21fb8dbf6d2530.
// See LICENSE and README.md for source and local changes.
const INVALID_INDEX = 0xffffffff;
export function tarjanLabels({ nodeCount, rowPtr, colIdx }) {
    const index = new Uint32Array(nodeCount).fill(INVALID_INDEX);
    const low = new Uint32Array(nodeCount);
    const cursor = new Uint32Array(nodeCount);
    const onStack = new Uint8Array(nodeCount);
    const callStack = new Uint32Array(nodeCount);
    const sccStack = new Uint32Array(nodeCount);
    const labels = new Uint32Array(nodeCount);
    let next = 0;
    let count = 0;
    let sp = 0;
    let top = 0;
    // The body of the recursive call before its loop over neighbours.
    const enter = (u) => {
        index[u] = next;
        low[u] = next;
        next++;
        cursor[u] = rowPtr[u];
        sccStack[sp++] = u;
        onStack[u] = 1;
        callStack[top++] = u;
    };
    for (let r = 0; r < nodeCount; r++) {
        if (index[r] !== INVALID_INDEX) {
            continue;
        }
        enter(r);
        while (top > 0) {
            const x = callStack[top - 1];
            if (cursor[x] < rowPtr[x + 1]) {
                const a = cursor[x]++;
                const v = colIdx[a];
                if (index[v] === INVALID_INDEX) {
                    enter(v);
                }
                else if (onStack[v] === 1 && index[v] < low[x]) {
                    low[x] = index[v];
                }
                continue;
            }
            // x returns: close its component if it is a root, then pass its low link to the caller.
            top--;
            if (low[x] === index[x]) {
                let w;
                do {
                    w = sccStack[--sp];
                    onStack[w] = 0;
                    labels[w] = count;
                } while (w !== x);
                count++;
            }
            if (top > 0 && low[x] < low[callStack[top - 1]]) {
                low[callStack[top - 1]] = low[x];
            }
        }
    }
    return { labels, count };
}
