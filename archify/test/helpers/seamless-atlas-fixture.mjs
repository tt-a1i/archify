import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const repository = path.dirname(root);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

// The authored topology remains the checked four-member/three-level example.
// Different canvas ratios, chapter counts and overview lengths intentionally
// exercise the workbench's two layout modes during one navigation path.
export function createSeamlessFixture(directory) {
  execFileSync(process.execPath, [path.join(repository, 'scripts/generate-viewer.mjs'), '--check'], { stdio: 'pipe' });
  fs.mkdirSync(directory, { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'examples/atlas/project.atlas.json'), 'utf8'));
  manifest.meta.title = '连续阅读验收图集';
  const variants = {
    system: { viewBox: [1100, 650], chapters: 3, cards: 3 },
    payment: { viewBox: [1100, 720], chapters: 2, cards: 2 },
    worker: { viewBox: [1100, 760], chapters: 0, cards: 1 },
    orders: { viewBox: [1100, 660], chapters: 1, cards: 3 },
  };
  const sources = [];
  for (const [id, member] of Object.entries(manifest.diagrams)) {
    const spec = JSON.parse(fs.readFileSync(path.join(root, 'examples/atlas', member.source), 'utf8'));
    const variant = variants[id];
    spec.meta.viewBox = variant.viewBox;
    spec.meta.animation = 'none';
    if (variant.chapters) spec.meta.views = spec.meta.views.slice(0, variant.chapters);
    else delete spec.meta.views;
    spec.cards = spec.cards.slice(0, variant.cards);
    const source = path.join(directory, member.source);
    fs.writeFileSync(source, `${JSON.stringify(spec, null, 2)}\n`);
    sources.push({ diagram: id, path: source, sha256: sha256(fs.readFileSync(source)), ...variant });
  }
  const input = path.join(directory, 'seamless.atlas.json');
  const output = path.join(directory, 'seamless.html');
  fs.writeFileSync(input, `${JSON.stringify(manifest, null, 2)}\n`);
  const entry = path.join(root, 'bin/archify.mjs');
  const args = [entry, 'deliver', 'atlas', input, output, '--json'];
  const rawReceipt = execFileSync(process.execPath, args, { encoding: 'utf8' });
  const receipt = JSON.parse(rawReceipt);
  assert.equal(receipt.ok, true, rawReceipt);
  assert.equal(receipt.output, output, 'Receipt and requested artifact must identify the same bytes');
  assert.deepEqual(receipt.validation.diagramIds, Object.keys(manifest.diagrams));
  for (const [diagram, member] of Object.entries(receipt.members)) {
    assert.equal(member.validation.checks.length, 9, `${diagram}: architecture checks`);
    assert.ok(member.validation.checks.every(check => check.ok), `${diagram}: all member checks pass`);
    assert.deepEqual(member.validation.composition.summary, { errors: 0, warnings: 0 });
  }
  assert.ok(fs.existsSync(output), 'Successful delivery must produce the requested file');
  const receiptPath = path.join(directory, 'delivery.receipt.json');
  fs.writeFileSync(receiptPath, rawReceipt);
  const codePaths = [
    'archify/bin/archify.mjs', 'archify/renderers/shared/atlas-shell.mjs',
    'archify/renderers/shared/atlas-bundle.mjs', 'archify/renderers/shared/atlas-delivery.mjs', 'archify/renderers/shared/utils.mjs',
    'archify/renderers/shared/atlas-navigation.mjs', 'archify/renderers/shared/atlas-workbench.mjs',
    'archify/renderers/shared/atlas-toolbar.mjs', 'viewer/viewer-address.js',
    'viewer/reader-layout.js', 'viewer/viewer-chrome-layout.js', 'viewer/viewer-camera.js',
    'viewer/template.source.html', 'viewer/export.js', 'viewer/motion-governor.js', 'archify/assets/template.html',
    'archify/test/helpers/seamless-atlas-fixture.mjs',
  ].filter(file => fs.existsSync(path.join(repository, file)));
  const git = (...arguments_) => execFileSync('git', ['-C', repository, ...arguments_], { encoding: 'utf8' }).trim();
  const provenance = {
    generatedAt: new Date().toISOString(), branch: git('branch', '--show-current'), head: git('rev-parse', 'HEAD'),
    command: [process.execPath, ...args],
    input: { path: input, sha256: sha256(fs.readFileSync(input)) },
    output: { path: output, sha256: sha256(fs.readFileSync(output)) },
    receipt: { path: receiptPath, sha256: sha256(fs.readFileSync(receiptPath)) },
    sources,
    code: codePaths.map(file => ({ path: path.join(repository, file), sha256: sha256(fs.readFileSync(path.join(repository, file))) })),
    worktreeStatus: git('status', '--short'),
  };
  fs.writeFileSync(path.join(directory, 'provenance.json'), `${JSON.stringify(provenance, null, 2)}\n`);
  return { input, output, receipt, provenance };
}
