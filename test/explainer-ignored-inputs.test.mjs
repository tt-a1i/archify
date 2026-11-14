import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const cli = path.resolve('archify/bin/archify.mjs');
const env = { ...process.env, ARCHIFY_UPDATE_CHECK_DISABLED: '1' };
function run(args, cwd) {
  const r = spawnSync(process.execPath, [cli, ...args, '--json'], { encoding: 'utf8', env, cwd });
  return { status: r.status, receipt: JSON.parse(r.stdout) };
}
function deliver(t, draft, files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-ignored-inputs-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
  const input = path.join(dir, 'draft.archify.md'), output = path.join(dir, 'page.html');
  fs.writeFileSync(input, draft);
  const r = run(['deliver', 'explainer', input, output, '--quality', 'showcase', '--writing', 'off'], dir);
  return { ...r, html: fs.existsSync(output) ? fs.readFileSync(output, 'utf8') : null };
}

const spec = {
  schema_version: 1,
  diagram_type: 'architecture',
  meta: { title: 'Title in the file', output: 'parts.html', quality_profile: 'showcase', locale: 'en' },
  components: [
    { id: 'api', type: 'backend', label: 'API', pos: [40, 40], size: [180, 64] },
    { id: 'db', type: 'database', label: 'Store', pos: [320, 40], size: [180, 64] }
  ],
  connections: [{ id: 'writes', from: 'api', to: 'db', label: 'writes' }]
};

test('explainer @diagram title= on a source file sets the rendered caption', t => {
  const draft = `# T {#t}\n\nA short answer.\n\n@meta locale=en\n\n## D {#d}\n\n@diagram architecture id=file-map source=parts.architecture.json title="Title in the draft"\n`;
  const { status, receipt, html } = deliver(t, draft, { 'parts.architecture.json': JSON.stringify(spec) });
  assert.equal(status, 0, JSON.stringify(receipt.diagnostics));
  assert.match(html, /<span class="diagram-title">Title in the draft<\/span>/);
  assert.doesNotMatch(html, /<span class="diagram-title">Title in the file<\/span>/);
});

test('explainer @diagram without title= keeps the source file caption', t => {
  const draft = `# T {#t}\n\nA short answer.\n\n@meta locale=en\n\n## D {#d}\n\n@diagram architecture id=file-map source=parts.architecture.json\n`;
  const { status, receipt, html } = deliver(t, draft, { 'parts.architecture.json': JSON.stringify(spec) });
  assert.equal(status, 0, JSON.stringify(receipt.diagnostics));
  assert.match(html, /<span class="diagram-title">Title in the file<\/span>/);
});

test('explainer checklists render the authored tick', t => {
  const draft = `# T {#t}\n\nA short answer.\n\n@meta locale=en\n\n## C {#c}\n\n- [x] Ticked by the author\n- [ ] Open\n`;
  const { status, receipt, html } = deliver(t, draft);
  assert.equal(status, 0, JSON.stringify(receipt.diagnostics));
  assert.match(html, /<ul class="checklist"><li><label><input type="checkbox" checked><span>Ticked by the author<\/span><\/label><\/li><li><label><input type="checkbox"><span>Open<\/span><\/label><\/li><\/ul>/);
});

test('retired meta.views is refused with a diagnostic', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-ignored-inputs-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'views.architecture.json');
  fs.writeFileSync(file, JSON.stringify({ ...spec, meta: { ...spec.meta, views: [{ id: 'v', label: 'V', focus: ['api'] }] } }));
  const { receipt } = run(['validate', 'architecture', file], dir);
  assert.equal(receipt.ok, false);
  assert.ok((receipt.diagnostics || []).some(d => /must NOT have additional properties/.test(d.message) && /meta/.test(d.message)),
    JSON.stringify(receipt.diagnostics));
});
