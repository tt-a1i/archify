import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cases = {
  architecture: ['web-app.architecture.json', 'components'],
  workflow: ['agent-tool-call.workflow.json', 'nodes'],
  sequence: ['cache-miss-request.sequence.json', 'participants'],
  dataflow: ['product-analytics.dataflow.json', 'nodes'],
  lifecycle: ['agent-run.lifecycle.json', 'states'],
};
for (const [mode, [example, collection]] of Object.entries(cases)) {
  test(`${mode}: icon overrides and hiding preserve all non-icon output`, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-icons-'));
    try {
      const spec = JSON.parse(fs.readFileSync(path.join(root, 'examples', example)));
      const input = path.join(dir, 'input.json');
      const output = path.join(dir, 'output.html');
      const render = () => {
        fs.writeFileSync(input, JSON.stringify(spec));
        const result = spawnSync(process.execPath, [path.join(root, `renderers/${mode}/render-${mode}.mjs`), input, output], { encoding: 'utf8' });
        assert.equal(result.status, 0, result.stderr);
        return fs.readFileSync(output, 'utf8');
      };
      const baseline = render();
      const sigil = /<g aria-hidden="true" data-semantic-sigil="[^"]+"[^>]*>[\s\S]*?<\/g>/;
      const old = baseline.match(sigil)?.[0];
      assert.ok(old);
      const icons = JSON.parse(fs.readFileSync(path.join(root, 'schemas/common.schema.json'))).$defs.nodeIcon.enum;
      for (const icon of icons) {
        spec[collection][0].icon = icon;
        const html = render();
        if (icon === 'none') {
          assert.equal(html, baseline.replace(old, ''));
        } else {
          const current = html.match(sigil)?.[0];
          assert.ok(current.includes(`data-semantic-sigil="${icon}"`));
          assert.equal(current.match(/class="([^"]+)"/)[1], old.match(/class="([^"]+)"/)[1]);
          assert.equal(html.replace(current, ''), baseline.replace(old, ''));
        }
      }
      delete spec[collection][0].icon;
      spec[collection][0].brand = 'openai';
      const branded = render();
      const brandedSigil = branded.match(sigil)[0];
      for (const icon of ['calendar', 'none']) {
        spec[collection][0].icon = icon;
        const html = render();
        assert.match(html, /data-brand-mark="openai"/);
        assert.equal(icon === 'none' ? html : html.replace(html.match(sigil)[0], ''), branded.replace(brandedSigil, ''));
      }
      spec[collection][0].icon = '<svg onload="alert(1)">';
      fs.writeFileSync(input, JSON.stringify(spec));
      const rejected = spawnSync(process.execPath, [path.join(root, 'bin/archify.mjs'), 'validate', mode, input, '--json'], { encoding: 'utf8' });
      assert.notEqual(rejected.status, 0);
      assert.match(rejected.stdout + rejected.stderr, /icon/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}
