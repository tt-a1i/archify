import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
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
    assert.match(scene.receipt, /7\/7 checks/);
  }
});

test('all README languages keep the product hero and retain the verified animated proof', () => {
  for (const filename of ['README.md', 'README_EN.md', 'README_ZH.md']) {
    const readme = fs.readFileSync(path.join(repoRoot, filename), 'utf8');
    const heroIndex = readme.indexOf('docs/assets/archify-readme-hero.png');
    const titleIndex = readme.indexOf('# Archify');
    const proofIndex = readme.indexOf('docs/assets/archify-live-proof.gif');
    const demosIndex = Math.max(readme.indexOf('## Interactive demos in 2.11'), readme.indexOf('## 2.11 交互演示'));
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

test('README 2.11 demos use checked-in captures and live deep links below the existing hero', () => {
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
    const demosIndex = Math.max(readme.indexOf('## Interactive demos in 2.11'), readme.indexOf('## 2.11 交互演示'));
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
    assert.ok(readme.split('\n').length <= 280, `${filename}: README grew beyond the scannable line budget`);
    for (const asset of commonAssets) {
      assert.ok(readme.includes(`docs/assets/${asset}`), `${filename}: visual proof ${asset} was removed`);
    }
  }

  const english = fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8');
  const wordCount = english.trim().split(/\s+/).length;
  const intro = english.slice(0, english.indexOf('![License]'));
  const introBullets = intro.match(/^- \*\*/gm) || [];
  assert.ok(wordCount <= 2000, `README.md is too verbose again (${wordCount} words)`);
  assert.ok(introBullets.length <= 8, `README.md has too many top-level capability bullets (${introBullets.length})`);

  const chinese = fs.readFileSync(path.join(repoRoot, 'README_ZH.md'), 'utf8');
  assert.ok(chinese.includes('docs/assets/claude-skills-settings.png'), 'README_ZH.md lost the Claude Skills setup image');
});
