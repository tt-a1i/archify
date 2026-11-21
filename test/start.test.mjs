import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
const cli = fileURLToPath(new URL('../archify/bin/archify.mjs', import.meta.url));
test('unified start documents standalone output and rejects a map without architecture input', () => {
  const help = spawnSync(process.execPath, [cli, 'start', '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /archify start/);
  assert.match(help.stdout, /\[--out/);
  const invalid = spawnSync(process.execPath, [cli, 'start', '.', '--map', 'map.json'], { encoding: 'utf8' });
  assert.equal(invalid.status, 2);
  assert.doesNotMatch(invalid.stderr, /at parseArgs|at startAnalysisView/);
  assert.match(invalid.stderr, /--map requires --ir/);
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
test('concurrent starts isolate default artifacts for the same project', { timeout: 30000 }, async t => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-start-test-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const repo = path.join(scratch, 'repo'); fs.mkdirSync(repo);
  fs.writeFileSync(path.join(repo, 'main.py'), 'x = 1');
  async function launch(title, withDiagram = true) {
    const ir = path.join(scratch, title + '.json');
    fs.writeFileSync(ir, JSON.stringify({ schema_version: 1, diagram_type: 'architecture', meta: { title, output: 'architecture.html' }, components: [{ id: 'app', type: 'backend', label: title, pos: [40,40], size: [170,64] }], connections: [] }));
    const child = spawn(process.execPath, [cli, 'start', repo, ...(withDiagram ? ['--ir', ir] : []), '--locale', 'zh-CN', '--language', 'py'], { stdio: ['ignore', 'pipe', 'pipe'] });
    t.after(() => new Promise(resolve => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      child.once('exit', resolve); child.kill();
    }));
    const output = await new Promise((resolve, reject) => {
      let text = '', errors = '';
      child.stderr.on('data', b => errors += b);
      child.once('error', reject);
      child.once('exit', code => reject(new Error(`startup exited ${code}: ${errors}`)));
      child.stdout.on('data', b => { text += b; if (text.includes('Press Ctrl+C')) resolve(text); });
    });
    const url = output.match(/Archify: (http:\/\/[^\s]+)/)[1];
    const artifact = output.match(withDiagram ? /Diagram: ([^\r\n]+)/ : /Analysis: ([^\r\n]+)/)[1];
    t.after(() => fs.rmSync(withDiagram ? path.dirname(artifact) : path.dirname(path.dirname(artifact)), { recursive: true, force: true }));
    return { url, artifact, withDiagram };
  }
  const first = await launch('First');
  const second = await launch('Second');
  const standalone = await launch('Standalone', false);
  assert.equal(fs.existsSync(standalone.artifact), false, 'no fake diagram is delivered for standalone start');
  assert.notEqual(first.artifact, second.artifact);
  for (const [view, title] of [[first, 'First'], [second, 'Second'], [standalone, null]]) {
    const before = view.withDiagram ? fs.readFileSync(view.artifact, 'utf8') : null;
    const page = await (await fetch(view.url)).text();
    const token = page.match(/\}\)\("([a-f0-9]{48})"/)[1];
    const response = await fetch(view.url + '/analyze', { method: 'POST', headers: { Origin: view.url, 'X-Analysis-Token': token } });
    const html = await response.text();
    assert.equal(response.status, 200, html);
    if (view.withDiagram) { assert.ok(html.includes(title)); assert.equal(fs.readFileSync(view.artifact, 'utf8'), before); }
    else { assert.match(html, /data-analysis-mode="standalone"/); assert.match(html, /lang="zh-CN"/); assert.ok(fs.existsSync(view.artifact)); }
  }
});
