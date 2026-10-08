import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateSchema } from '../archify/renderers/shared/validator.mjs';

const cli = fileURLToPath(new URL('../archify/bin/archify.mjs', import.meta.url));

for (const quality of ['standard', 'showcase']) {
  test(`sequence ${quality} names unsupported self-messages without advertising a spacing repair`, t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-sequence-self-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const input = path.join(dir, 'input.json');
    const doc = {
      schema_version: 1, diagram_type: 'sequence',
      meta: { title: 'Internal operation', output: 'self.html', quality_profile: quality },
      participants: [
        { id: 'caller', type: 'frontend', label: 'Caller' },
        { id: 'worker', type: 'backend', label: 'Worker' },
      ],
      messages: [
        { id: 'request', from: 'caller', to: 'worker', y: 200, label: 'Request' },
        { id: 'internal', from: 'worker', to: 'worker', y: 260, label: 'Apply local policy' },
      ],
    };
    assert.doesNotThrow(() => validateSchema('sequence', doc), 'schema accepts the unsupported renderer capability');
    fs.writeFileSync(input, JSON.stringify(doc));
    const result = spawnSync(process.execPath, [cli, 'validate', 'sequence', input, '--quality', quality, '--json'], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    const receipt = JSON.parse(result.stdout);
    const diagnostic = receipt.diagnostics.find(({ code }) => code === 'sequence/self-message-unsupported');
    assert.ok(diagnostic, result.stdout || result.stderr);
    assert.equal(diagnostic.subject.path, '/messages/1');
    assert.equal(diagnostic.subject.collection, 'messages');
    assert.equal(diagnostic.subject.index, 1);
    assert.equal(diagnostic.subject.id, 'internal');
    assert.equal(diagnostic.subject.from, 'worker');
    assert.equal(diagnostic.subject.to, 'worker');
    assert.equal(diagnostic.subject.fromPath, '/messages/1/from');
    assert.equal(diagnostic.subject.toPath, '/messages/1/to');
    assert.equal(diagnostic.evidence.participant, 'worker');
    assert.equal(diagnostic.evidence.participantPath, '/participants/1');
    assert.equal(diagnostic.evidence.y, 260);
    assert.equal(diagnostic.evidence.supportedMessageGeometry, 'horizontal-between-distinct-participants');
    assert.deepEqual(diagnostic.supportedFixes, []);
    assert.match(diagnostic.message, /meaning and order/);
    assert.doesNotMatch(result.stdout, /spans 0px|give its participants more column distance/);
    assert.deepEqual(JSON.parse(fs.readFileSync(input, 'utf8')), doc, 'rejection preserves authored semantics');
    assert.equal(fs.existsSync(path.join(dir, 'self.html')), false);
    const output = path.join(dir, 'rendered.html');
    const rendered = spawnSync(process.execPath, [cli, 'render', 'sequence', input, output, '--quality', quality], { encoding: 'utf8' });
    assert.notEqual(rendered.status, 0);
    assert.match(rendered.stderr, /self-message on participant "worker"/);
    assert.doesNotMatch(rendered.stderr, /spans 0px|give its participants more column distance/);
    assert.equal(fs.existsSync(output), false, 'render rejects before producing an artifact');
  });
}
