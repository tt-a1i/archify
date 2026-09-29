import assert from 'node:assert/strict';
import { assembleViewer } from '../../../scripts/generate-viewer.mjs';

// Legacy source-contract assertions inspect spelling/structure, not minifier
// formatting. First verify the delivered blocks are EXACTLY the compiled
// authoritative source; only then expose that source to those assertions.
// Browser suites always load the untouched, compact on-disk artifact.
const blocks = (html) => [...html.matchAll(/<(script|style)>([\s\S]*?)<\/\1>/g)].map(match => match[0]);
const source = blocks(assembleViewer({ compact: false }));
const delivered = blocks(assembleViewer());
assert.equal(source.length, delivered.length);

export function viewerContractSource(html) {
  for (let i = 0; i < source.length; i++) {
    assert.ok(html.includes(delivered[i]), `Missing/stale compiled Viewer block ${i}`);
    html = html.replace(delivered[i], () => source[i]);
  }
  return html;
}
