import { clientAsset } from './client-assets.mjs';
import { scriptSafeJson } from './inject.mjs';
import { fail } from '../core/index.mjs';
import { driftTask } from '../lib/drift-verification.mjs';

export function renderDriftOverlay(html, result, reportSha256) {
  const end = html.lastIndexOf('</body>');
  if (end < 0 || !html.includes('data-node-id=') || !html.includes('class="toolbar"')) {
    fail('drift/diagram-invalid', 'The delivered Architecture HTML did not contain a diagram and toolbar.');
  }
  const edges = result.edges.map(edge => edge.state === 'new-undeclared'
    ? { ...edge, task: driftTask(reportSha256, edge) } : edge);
  return html.slice(0, end) + '\n<script type="application/json" id="architecture-drift-data">' +
    scriptSafeJson({ ...result, edges }) + '</script>\n<style>' + clientAsset('drift.css') + '</style>\n<script>' +
    clientAsset('drift.js') + '</script>\n' + html.slice(end);
}
