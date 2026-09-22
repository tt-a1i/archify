import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const hostileStructureText = 'STRUCTURE_ONLY_SENTINEL 中文 🧭 "quotes" \\ path <>& </script><img id="structure-injected" src="https://structure-injection.invalid/x">';

export function makeInternalStructureFixture(directory) {
  fs.mkdirSync(directory, { recursive: true });
  const repository = path.join(directory, 'repository');
  fs.mkdirSync(path.join(repository, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repository, 'src/runtime.mjs'), [
    'export const state = new Map();',
    'export function accept(key, value) { state.set(key, value); return value; }',
    'export function lookup(key) { return state.get(key); }',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(repository, 'src/caller.mjs'), [
    "import { accept, lookup } from './runtime.mjs';",
    'export function submit(key, value) { accept(key, value); return lookup(key); }',
    '',
  ].join('\n'));
  const git = (...args) => execFileSync('git', ['-C', repository, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_AUTHOR_DATE: '2000-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2000-01-01T00:00:00Z' },
  }).trim();
  git('init');
  git('config', 'user.name', 'Archify Tests');
  git('config', 'user.email', 'archify@example.test');
  git('remote', 'add', 'origin', 'https://github.com/example/internal-structure-fixture');
  git('add', 'src');
  git('commit', '-m', 'Fixed internal structure browser evidence');
  const revision = git('rev-parse', 'HEAD');
  const sources = [
    { id: 'runtime-definition', role: 'definition', symbol: 'accept', path: 'src/runtime.mjs', line: 1, end_line: 3, label: 'Runtime definitions' },
    { id: 'runtime-call', role: 'callsite', symbol: 'submit', path: 'src/caller.mjs', line: 1, end_line: 2, label: 'Caller observation' },
  ];
  const both = (hostile = false) => ({
    sources: structuredClone(sources),
    items: [
      { id: 'src', domain: 'code', kind: 'directory', label: 'src', summary: hostile ? hostileStructureText : 'Runtime sources.' },
      { id: 'runtime-file', domain: 'code', kind: 'file', label: 'runtime.mjs', parent: 'src', summary: 'Owns runtime state.', source_refs: ['runtime-definition'] },
      { id: 'accept', domain: 'code', kind: 'function', label: 'accept', parent: 'runtime-file', signature: 'accept(key, value)', summary: 'Stores one keyed value.', source_refs: ['runtime-definition'] },
      { id: 'runtime-state', domain: 'state', kind: 'group', label: 'Runtime state', summary: 'In-memory state owned by the runtime.' },
      { id: 'state-map', domain: 'state', kind: 'field', label: 'state', parent: 'runtime-state', value_type: 'Map<string, unknown>', summary: 'Holds keyed values.', source_refs: ['runtime-definition'] },
    ],
    relations: [
      { id: 'accept-writes-state', from: 'accept', to: 'state-map', kind: 'writes', label: 'stores value', source_refs: ['runtime-call'] },
    ],
  });
  const codeOnly = () => {
    const value = both();
    value.items = value.items.filter(item => item.domain === 'code');
    value.relations = [];
    return value;
  };
  const stateOnly = () => {
    const value = both();
    value.items = value.items.filter(item => item.domain === 'state');
    value.relations = [];
    return value;
  };

  const outputs = {};
  for (const locale of ['en', 'zh-CN']) {
    const localeDirectory = path.join(directory, locale);
    fs.mkdirSync(localeDirectory);
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'examples/atlas/project.atlas.json'), 'utf8'));
    manifest.meta.locale = locale;
    for (const [diagramId, member] of Object.entries(manifest.diagrams)) {
      const spec = JSON.parse(fs.readFileSync(path.join(root, 'examples/atlas', member.source), 'utf8'));
      spec.meta.locale = locale;
      spec.meta.repository = { url: 'https://github.com/example/internal-structure-fixture', revision, link_mode: 'local-only' };
      for (const node of spec.components) {
        if (node.id === 'controller') node.internal_structure = diagramId === 'system' ? both() : codeOnly();
        if (diagramId === 'system' && node.id === 'redis') node.internal_structure = both(true);
        if (diagramId === 'system' && node.id === 'db') node.internal_structure = stateOnly();
      }
      fs.writeFileSync(path.join(localeDirectory, member.source), `${JSON.stringify(spec, null, 2)}\n`);
    }
    const atlasInput = path.join(localeDirectory, 'project.atlas.json');
    fs.writeFileSync(atlasInput, `${JSON.stringify(manifest, null, 2)}\n`);
    outputs[locale] = {};
    for (const mode of ['architecture', 'atlas']) {
      const input = mode === 'atlas' ? atlasInput : path.join(localeDirectory, 'system.architecture.json');
      const output = path.join(localeDirectory, `${mode}.html`);
      const result = spawnSync(process.execPath, [path.join(root, 'bin/archify.mjs'), 'deliver', mode, input, output,
        '--repo-root', repository, '--json'], { encoding: 'utf8' });
      assert.equal(result.status, 0, `${locale}/${mode}: ${result.stderr}\n${result.stdout}`);
      outputs[locale][mode] = output;
    }
  }
  return { directory, repository, revision, outputs };
}
