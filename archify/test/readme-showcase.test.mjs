import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(skillRoot, '..');
const assetPath = path.join(repoRoot, 'docs', 'assets', 'archify-live-proof.gif');
const receiptPath = path.join(repoRoot, 'docs', 'assets', 'archify-live-proof.json');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function writeStarHistoryCharts(cwd, version) {
  const assets = path.join(cwd, 'assets');
  fs.mkdirSync(assets, { recursive: true });
  fs.writeFileSync(path.join(assets, 'star-history-light.svg'), `<svg><title>light ${version}</title></svg>\n`);
  fs.writeFileSync(path.join(assets, 'star-history-dark.svg'), `<svg><title>dark ${version}</title></svg>\n`);
}

function skipSubBlocks(buffer, start) {
  let offset = start;
  while (offset < buffer.length) {
    const size = buffer[offset];
    offset += 1;
    if (size === 0) return offset;
    offset += size;
  }
  throw new Error('GIF sub-block runs past end of file');
}

function inspectGif(buffer) {
  assert.match(buffer.subarray(0, 6).toString('ascii'), /^GIF8[79]a$/);
  const width = buffer.readUInt16LE(6);
  const height = buffer.readUInt16LE(8);
  const packed = buffer[10];
  let offset = 13;
  if (packed & 0x80) offset += 3 * (2 ** ((packed & 0x07) + 1));
  let frameCount = 0;
  let durationCentiseconds = 0;
  let trailer = false;

  while (offset < buffer.length) {
    const marker = buffer[offset];
    offset += 1;
    if (marker === 0x3b) {
      trailer = true;
      break;
    }
    if (marker === 0x21) {
      const label = buffer[offset];
      offset += 1;
      if (label === 0xf9) {
        const blockSize = buffer[offset];
        offset += 1;
        assert.equal(blockSize, 4, 'unexpected graphic-control block size');
        durationCentiseconds += buffer.readUInt16LE(offset + 1);
        offset += blockSize;
        assert.equal(buffer[offset], 0, 'graphic-control block missing terminator');
        offset += 1;
      } else {
        offset = skipSubBlocks(buffer, offset);
      }
      continue;
    }
    if (marker === 0x2c) {
      frameCount += 1;
      const localPacked = buffer[offset + 8];
      offset += 9;
      if (localPacked & 0x80) offset += 3 * (2 ** ((localPacked & 0x07) + 1));
      offset += 1;
      offset = skipSubBlocks(buffer, offset);
      continue;
    }
    throw new Error(`unexpected GIF marker 0x${marker.toString(16)} at ${offset - 1}`);
  }
  assert.equal(trailer, true, 'GIF trailer missing');
  return { width, height, frameCount, durationSeconds: durationCentiseconds / 100 };
}

test('README motion proof is compact, looping, and backed by current gallery artifacts', () => {
  const builder = fs.readFileSync(path.join(repoRoot, 'scripts', 'build-readme-showcase.mjs'), 'utf8');
  assert.match(builder, /\?embed=1&play=1&theme=dark#view=/);
  const buffer = fs.readFileSync(assetPath);
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  const inspected = inspectGif(buffer);

  assert.deepEqual(inspected, { width: 960, height: 540, frameCount: 54, durationSeconds: 5.4 });
  assert.ok(buffer.includes(Buffer.from('NETSCAPE2.0')), 'GIF must loop continuously');
  assert.ok(buffer.byteLength <= 3 * 1024 * 1024, `README GIF is too large: ${buffer.byteLength} bytes`);
  assert.equal(receipt.schemaVersion, 1);
  assert.equal(receipt.generator, 'scripts/build-readme-showcase.mjs');
  assert.equal(receipt.output, 'docs/assets/archify-live-proof.gif');
  assert.equal(receipt.width, inspected.width);
  assert.equal(receipt.height, inspected.height);
  assert.equal(receipt.frameCount, inspected.frameCount);
  assert.equal(receipt.durationSeconds, inspected.durationSeconds);
  assert.equal(receipt.bytes, buffer.byteLength);
  assert.equal(receipt.sha256, sha256(assetPath));
  assert.deepEqual(receipt.scenes.map(scene => scene.id), ['signal-flow', 'blueprint', 'classic']);
  for (const scene of receipt.scenes) {
    const artifact = path.join(repoRoot, scene.artifact);
    assert.ok(fs.existsSync(artifact), `${scene.id}: source artifact missing`);
    assert.equal(scene.artifactSha256, sha256(artifact), `${scene.id}: source artifact drift; rebuild README showcase`);
    assert.match(scene.receipt, /9\/9 checks/);
  }
});

test('all README languages keep the product hero and retain the verified animated proof', () => {
  for (const filename of ['README.md', 'README_EN.md', 'README_ZH.md']) {
    const readme = fs.readFileSync(path.join(repoRoot, filename), 'utf8');
    const heroIndex = readme.indexOf('docs/assets/archify-readme-hero.png');
    const titleIndex = readme.indexOf('# Archify');
    const proofIndex = readme.indexOf('docs/assets/archify-live-proof.gif');
    const demosIndex = Math.max(readme.indexOf('## See Archify in action'), readme.indexOf('## 看看 Archify 能做什么'));
    assert.ok(heroIndex >= 0 && heroIndex < titleIndex, `${filename}: product hero is not above the title`);
    assert.ok(proofIndex > demosIndex, `${filename}: animated proof must live in the demo section`);
    assert.match(readme, /docs\/assets\/archify-live-proof\.gif/);
    assert.match(readme, /https:\/\/tt-a1i\.github\.io\/archify\/gallery\.html/);
  }
  assert.equal(
    fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8'),
    fs.readFileSync(path.join(repoRoot, 'README_EN.md'), 'utf8'),
    'README.md and README_EN.md must stay synchronized',
  );
});

test('README installation tables contain a complete DeepSeek Harness row', () => {
  for (const filename of ['README.md', 'README_EN.md', 'README_ZH.md']) {
    const readme = fs.readFileSync(path.join(repoRoot, filename), 'utf8');
    const row = readme.split('\n').find((line) => line.startsWith('| **DeepSeek Harness** |'));
    assert.ok(row, `${filename}: DeepSeek Harness must be an installation table row`);
    assert.equal(
      (row.match(/(?<!\\)\|/g) || []).length,
      4,
      `${filename}: DeepSeek Harness must have exactly three table cells`,
    );
    assert.ok(
      row.includes('Node `^22.19.0 \\|\\| >=24.0.0`'),
      `${filename}: Node version pipes must be escaped inside the table row`,
    );
    assert.ok(
      readme.includes(`${row}\n\n`),
      `${filename}: installation table must end after the DeepSeek Harness row`,
    );
  }
});

test('README demos use checked-in captures and live deep links below the existing hero', () => {
  const demos = [
    {
      asset: 'archify-demo-story.png',
      link: 'agent-tool-call.workflow.html?theme=dark&present=1&play=1#view=happy-path',
    },
    {
      asset: 'archify-demo-route.png',
      link: 'cache-miss.sequence.html?theme=dark&present=1#route=web~db',
    },
    {
      asset: 'archify-demo-lens.png',
      link: 'production-deployment.architecture.html?theme=dark&present=1#lens=backend~database',
    },
  ];

  for (const demo of demos) {
    const buffer = fs.readFileSync(path.join(repoRoot, 'docs', 'assets', demo.asset));
    assert.equal(buffer.subarray(1, 4).toString('ascii'), 'PNG', `${demo.asset}: invalid PNG signature`);
    assert.equal(buffer.readUInt32BE(16), 1280, `${demo.asset}: unexpected width`);
    assert.equal(buffer.readUInt32BE(20), 720, `${demo.asset}: unexpected height`);
    assert.ok(buffer.byteLength < 400 * 1024, `${demo.asset}: capture is too large`);
  }

  for (const filename of ['README.md', 'README_EN.md', 'README_ZH.md']) {
    const readme = fs.readFileSync(path.join(repoRoot, filename), 'utf8');
    const heroIndex = readme.indexOf('docs/assets/archify-readme-hero.png');
    const proofIndex = readme.indexOf('docs/assets/archify-live-proof.gif');
    const previewIndex = Math.max(readme.indexOf('## Preview'), readme.indexOf('## 预览'));
    const demosIndex = Math.max(readme.indexOf('## See Archify in action'), readme.indexOf('## 看看 Archify 能做什么'));
    const quickStartIndex = Math.max(readme.indexOf('## Quick start'), readme.indexOf('## 快速开始'));
    assert.ok(heroIndex >= 0 && heroIndex < demosIndex, `${filename}: existing hero proof moved`);
    assert.ok(demosIndex < previewIndex && previewIndex < quickStartIndex, `${filename}: demo section is misplaced`);
    assert.ok(demosIndex < proofIndex && proofIndex < previewIndex, `${filename}: animated proof is outside the demo section`);
    for (const demo of demos) {
      assert.match(readme, new RegExp(`docs/assets/${demo.asset.replaceAll('.', '\\.')}`));
      assert.ok(readme.includes(demo.link), `${filename}: missing ${demo.link}`);
    }
  }
});

test('README stays scannable without deleting the visual proof set', () => {
  const commonAssets = [
    'archify-readme-hero.png',
    'archify-live-proof.gif',
    'archify-demo-story.png',
    'archify-demo-route.png',
    'archify-demo-lens.png',
    'mco-runtime-share-card.png',
    'archify-dark.png',
    'archify-light.png',
    'archify-menu.png',
    'archify-workflow.png',
    'archify-sequence.png',
    'archify-dataflow.png',
    'archify-lifecycle.png',
  ];

  for (const filename of ['README.md', 'README_EN.md', 'README_ZH.md']) {
    const readme = fs.readFileSync(path.join(repoRoot, filename), 'utf8');
    assert.ok(readme.split('\n').length <= 295, `${filename}: README grew beyond the scannable line budget`);
    assert.match(readme, filename === 'README_ZH.md' ? /不需要绑定代码库/ : /No repository is required/);
    for (const asset of commonAssets) {
      assert.ok(readme.includes(`docs/assets/${asset}`), `${filename}: visual proof ${asset} was removed`);
    }
  }

  const english = fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8');
  const wordCount = english.trim().split(/\s+/).length;
  const intro = english.slice(0, english.indexOf('![License]'));
  const introBullets = intro.match(/^- \*\*/gm) || [];
  assert.ok(wordCount <= 2085, `README.md is too verbose again (${wordCount} words)`);
  assert.ok(introBullets.length <= 8, `README.md has too many top-level capability bullets (${introBullets.length})`);

  const chinese = fs.readFileSync(path.join(repoRoot, 'README_ZH.md'), 'utf8');
  assert.ok(chinese.includes('docs/assets/claude-skills-settings.png'), 'README_ZH.md lost the Claude Skills setup image');
});

test('all README languages end with the self-hosted star history chart', () => {
  const lightChart = 'https://raw.githubusercontent.com/tt-a1i/archify/star-history/assets/star-history-light.svg';
  const darkChart = 'https://raw.githubusercontent.com/tt-a1i/archify/star-history/assets/star-history-dark.svg';
  const workflow = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'star-history.yml'), 'utf8');

  for (const filename of ['README.md', 'README_EN.md', 'README_ZH.md']) {
    const readme = fs.readFileSync(path.join(repoRoot, filename), 'utf8');
    const sectionIndex = readme.lastIndexOf('## Star History');
    const contributingIndex = Math.max(readme.indexOf('## Contributing'), readme.indexOf('## 参与贡献'));
    assert.ok(sectionIndex > contributingIndex, `${filename}: Star History must follow Contributing`);
    assert.ok(readme.includes(lightChart), `${filename}: missing light star history chart`);
    assert.ok(readme.includes(darkChart), `${filename}: missing dark star history chart`);
    assert.equal(readme.trimEnd().endsWith('</p>'), true, `${filename}: Star History must remain the final section`);
  }

  assert.match(workflow, /permissions:\n  contents: write/);
  assert.match(workflow, /narayann7\/star-history-action@[0-9a-f]{40}/);
  // Upstream PR #6 migrates setup-node to Node 24 without the v1.0.6 chart changes.
  assert.match(workflow, /narayann7\/star-history-action@00dfada13f106e4114ee46728aa415857078e76c\s/);
  assert.match(workflow, /output-dir: assets/);
  assert.match(workflow, /update-readme: ['"]false['"]/);
  assert.match(workflow, /commit: ['"]false['"]/);
  assert.match(workflow, /bash scripts\/publish-star-history\.sh star-history/);
  assert.doesNotMatch(workflow, /branch: star-history/);
  assert.doesNotMatch(workflow, /xpzouying\/star-history/);
});

test('Star History publishing advances the data branch without a force push', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-star-history-'));
  const remote = path.join(fixture, 'remote.git');
  const firstCheckout = path.join(fixture, 'first');
  const secondCheckout = path.join(fixture, 'second');
  const publisher = path.join(repoRoot, 'scripts', 'publish-star-history.sh');

  try {
    git(fixture, 'init', '--bare', remote);
    git(fixture, '--git-dir', remote, 'config', 'receive.denyNonFastForwards', 'true');
    git(fixture, '--git-dir', remote, 'config', 'receive.denyDeletes', 'true');

    fs.mkdirSync(firstCheckout);
    git(firstCheckout, 'init', '-b', 'main');
    git(firstCheckout, 'config', 'user.name', 'Fixture');
    git(firstCheckout, 'config', 'user.email', 'fixture@example.com');
    fs.writeFileSync(path.join(firstCheckout, 'README.md'), 'fixture\n');
    git(firstCheckout, 'add', 'README.md');
    git(firstCheckout, 'commit', '-m', 'seed');
    git(firstCheckout, 'remote', 'add', 'origin', remote);
    git(firstCheckout, 'push', '-u', 'origin', 'main');

    const firstTemp = path.join(fixture, 'run-1');
    fs.mkdirSync(firstTemp);
    writeStarHistoryCharts(firstCheckout, 'v1');
    execFileSync('bash', [publisher, 'star-history'], {
      cwd: firstCheckout,
      env: { ...process.env, RUNNER_TEMP: firstTemp },
    });
    const firstCommit = git(fixture, '--git-dir', remote, 'rev-parse', 'refs/heads/star-history');

    git(fixture, 'clone', '--branch', 'main', remote, secondCheckout);
    const secondTemp = path.join(fixture, 'run-2');
    fs.mkdirSync(secondTemp);
    writeStarHistoryCharts(secondCheckout, 'v2');
    execFileSync('bash', [publisher, 'star-history'], {
      cwd: secondCheckout,
      env: { ...process.env, RUNNER_TEMP: secondTemp },
    });
    const secondCommit = git(fixture, '--git-dir', remote, 'rev-parse', 'refs/heads/star-history');

    assert.notEqual(secondCommit, firstCommit);
    git(fixture, '--git-dir', remote, 'merge-base', '--is-ancestor', firstCommit, secondCommit);
    assert.deepEqual(
      git(fixture, '--git-dir', remote, 'ls-tree', '-r', '--name-only', secondCommit).split('\n'),
      ['assets/star-history-dark.svg', 'assets/star-history-light.svg'],
    );
    assert.match(
      git(fixture, '--git-dir', remote, 'show', `${secondCommit}:assets/star-history-light.svg`),
      /light v2/,
    );
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});
