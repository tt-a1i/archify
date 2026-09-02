import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(here, '..');
const cli = path.join(skillRoot, 'bin', 'archify.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-subarchitecture-validation-'));

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: skillRoot,
    encoding: 'utf8',
  });
}

function baseDiagram() {
  return {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: {
      title: 'Scoped subarchitecture validation fixture',
      viewBox: [720, 360],
      legend: { mode: 'hidden' },
    },
    components: [
      {
        id: 'parent-a',
        type: 'backend',
        label: 'Parent A',
        pos: [80, 120],
        size: [160, 72],
        subarchitecture: {
          title: 'Parent A internals',
          components: [
            {
              id: 'local-a',
              type: 'backend',
              label: 'Local A',
              pos: [40, 100],
              size: [120, 60],
            },
            {
              id: 'local-b',
              type: 'backend',
              label: 'Local B',
              pos: [240, 100],
              size: [120, 60],
            },
          ],
          boundaries: [],
          connections: [
            { id: 'local-flow', from: 'local-a', to: 'local-b' },
          ],
        },
      },
      {
        id: 'parent-b',
        type: 'backend',
        label: 'Parent B',
        pos: [400, 120],
        size: [160, 72],
        subarchitecture: {
          title: 'Parent B internals',
          components: [
            {
              id: 'other-local',
              type: 'backend',
              label: 'Other Local',
              pos: [40, 100],
              size: [120, 60],
            },
          ],
          boundaries: [],
          connections: [],
        },
      },
    ],
    boundaries: [],
    connections: [],
  };
}

function writeFixture(name, mutate = () => {}) {
  const diagram = baseDiagram();
  mutate(diagram);
  const input = path.join(tmp, `${name}.architecture.json`);
  fs.writeFileSync(input, `${JSON.stringify(diagram, null, 2)}\n`);
  return { diagram, input };
}

function assertValidationFailure(result, code, subjectPath) {
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.equal(result.stderr, '');
  const failure = JSON.parse(result.stdout);
  assert.equal(failure.ok, false);
  assert.equal(failure.command, 'validate');
  assert.equal(failure.stage, 'render');
  assert.equal(failure.type, 'architecture');
  assert.equal(failure.diagnostics.length, 1, JSON.stringify(failure.diagnostics, null, 2));
  assert.equal(failure.diagnostics[0].code, code);
  assert.equal(failure.diagnostics[0].subject.path, subjectPath);
  return failure;
}

test('rejects a duplicate local component id at the second authored id path', () => {
  const { input } = writeFixture('duplicate-local-component', (diagram) => {
    const local = diagram.components[0].subarchitecture;
    local.components[1].id = 'local-a';
    local.connections = [];
  });

  const result = run(['validate', 'architecture', input, '--json']);
  assertValidationFailure(
    result,
    'architecture/subarchitecture/duplicate-component-id',
    '/components/0/subarchitecture/components/1/id',
  );
});

test('rejects a duplicate authored local connection id at the second id path', () => {
  const { input } = writeFixture('duplicate-local-connection', (diagram) => {
    diagram.components[0].subarchitecture.connections.push({
      id: 'local-flow',
      from: 'local-b',
      to: 'local-a',
    });
  });

  const result = run(['validate', 'architecture', input, '--json']);
  assertValidationFailure(
    result,
    'architecture/subarchitecture/duplicate-connection-id',
    '/components/0/subarchitecture/connections/1/id',
  );
});

test('rejects a child connection endpoint that resolves to a parent component', () => {
  const { input } = writeFixture('child-to-parent-endpoint', (diagram) => {
    diagram.components[0].subarchitecture.connections[0].to = 'parent-a';
  });

  const result = run(['validate', 'architecture', input, '--json']);
  assertValidationFailure(
    result,
    'architecture/subarchitecture/scope-crossing',
    '/components/0/subarchitecture/connections/0/to',
  );
});

test('rejects a child connection endpoint from another parent scope', () => {
  const { input } = writeFixture('child-to-other-parent-child', (diagram) => {
    diagram.components[0].subarchitecture.connections[0].to = 'other-local';
  });

  const result = run(['validate', 'architecture', input, '--json']);
  assertValidationFailure(
    result,
    'architecture/subarchitecture/scope-crossing',
    '/components/0/subarchitecture/connections/0/to',
  );
});

test('rejects an entirely unknown child connection endpoint', () => {
  const { input } = writeFixture('unknown-child-endpoint', (diagram) => {
    diagram.components[0].subarchitecture.connections[0].to = 'ghost-local';
  });

  const result = run(['validate', 'architecture', input, '--json']);
  assertValidationFailure(
    result,
    'architecture/subarchitecture/unknown-endpoint',
    '/components/0/subarchitecture/connections/0/to',
  );
});

test('rejects a local boundary member that resolves outside its local scope', () => {
  const { input } = writeFixture('boundary-to-parent-member', (diagram) => {
    diagram.components[0].subarchitecture.boundaries = [{
      kind: 'region',
      label: 'Local region',
      wraps: ['parent-a'],
    }];
  });

  const result = run(['validate', 'architecture', input, '--json']);
  assertValidationFailure(
    result,
    'architecture/subarchitecture/scope-crossing',
    '/components/0/subarchitecture/boundaries/0/wraps/0',
  );
});

test('rejects an entirely unknown local boundary member', () => {
  const { input } = writeFixture('unknown-boundary-member', (diagram) => {
    diagram.components[0].subarchitecture.boundaries = [{
      kind: 'security-group',
      label: 'Local private scope',
      wraps: ['ghost-local'],
    }];
  });

  const result = run(['validate', 'architecture', input, '--json']);
  assertValidationFailure(
    result,
    'architecture/subarchitecture/unknown-boundary-member',
    '/components/0/subarchitecture/boundaries/0/wraps/0',
  );
});

test('rejects a parent connection endpoint that names a child component', () => {
  const { input } = writeFixture('parent-to-child-endpoint', (diagram) => {
    diagram.connections = [{ id: 'parent-child', from: 'parent-a', to: 'local-a' }];
  });

  const result = run(['validate', 'architecture', input, '--json']);
  assertValidationFailure(
    result,
    'architecture/subarchitecture/scope-crossing',
    '/connections/0/to',
  );
});

test('allows the same child id to be reused under different parents', () => {
  const { input } = writeFixture('same-child-id-different-parents', (diagram) => {
    diagram.components[1].subarchitecture.components[0].id = 'local-a';
  });

  const result = run(['validate', 'architecture', input, '--json']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.ok, true);
  assert.equal(receipt.command, 'validate');
  assert.equal(receipt.type, 'architecture');
});

test('deliver preserves sentinel output bytes when local validation fails', () => {
  const { input } = writeFixture('sentinel-invalid-local-endpoint', (diagram) => {
    diagram.components[0].subarchitecture.connections[0].to = 'ghost-local';
  });
  const output = path.join(tmp, 'sentinel-output.html');
  const sentinel = Buffer.from('<!doctype html>\n<title>trusted sentinel \u96ea</title>\n', 'utf8');
  fs.writeFileSync(output, sentinel);

  const result = run(['deliver', 'architecture', input, output, '--json']);
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.equal(result.stderr, '');
  const failure = JSON.parse(result.stdout);
  assert.equal(failure.ok, false);
  assert.equal(failure.command, 'deliver');
  assert.equal(failure.stage, 'render');
  assert.equal(failure.diagnostics.length, 1, JSON.stringify(failure.diagnostics, null, 2));
  assert.equal(failure.diagnostics[0].code, 'architecture/subarchitecture/unknown-endpoint');
  assert.equal(
    failure.diagnostics[0].subject.path,
    '/components/0/subarchitecture/connections/0/to',
  );
  assert.deepEqual(fs.readFileSync(output), sentinel);
  assert.deepEqual(
    fs.readdirSync(tmp).filter((name) => name.startsWith('.archify-delivery-')),
    [],
  );
});
