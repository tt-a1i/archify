import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..', 'archify');
const repoRoot = path.resolve(skillRoot, '..');
const assetPath = path.join(repoRoot, 'docs', 'assets', 'archify-live-proof.gif');
const receiptPath = path.join(repoRoot, 'docs', 'assets', 'archify-live-proof.json');

const readmeLanguages = [
  {
    file: 'README.md',
    href: './README.md',
    label: 'English',
    demos: '## See Archify in action',
    quickStart: '## Quick start',
    contributing: '## Contributing',
    noRepository: /No repository is required/,
  },
  {
    file: 'README_EN.md',
    href: './README.md',
    label: 'English',
    demos: '## See Archify in action',
    quickStart: '## Quick start',
    contributing: '## Contributing',
    noRepository: /No repository is required/,
  },
  {
    file: 'README_ZH.md',
    href: './README_ZH.md',
    label: '简体中文',
    demos: '## 看看 Archify 能做什么',
    quickStart: '## 快速开始',
    contributing: '## 参与贡献',
    noRepository: /不需要绑定代码库/,
  },
  {
    file: 'README_JA.md',
    href: './README_JA.md',
    label: '日本語',
    demos: '## 実際の Archify',
    quickStart: '## クイックスタート',
    contributing: '## コントリビュート',
    noRepository: /リポジトリは不要です/,
  },
];

function sectionIndex(readme, filename, heading) {
  const index = readme.indexOf(heading);
  assert.ok(index >= 0, `${filename}: section heading ${heading} is missing`);
  return index;
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function git(cwd, args, env = process.env) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env }).trim();
}

// Git for Windows installs bash.exe beside the git.exe that owns the repository.
// `git --exec-path` returns GIT_EXEC_PATH unchanged, so discovery must not walk
// up from that override: a missing directory there would hide the installed Bash.
function gitBashForWindows(cwd, env = process.env) {
  const discoveryEnv = { ...env };
  for (const key of Object.keys(discoveryEnv)) {
    if (key.toUpperCase() === 'GIT_EXEC_PATH') delete discoveryEnv[key];
  }
  const execPath = git(cwd, ['--exec-path'], discoveryEnv);
  const gitExe = path.resolve(execPath, '..', '..', 'bin', 'git.exe');
  const gitBash = path.resolve(execPath, '..', '..', '..', 'bin', 'bash.exe');
  return { gitExe, gitBash };
}

function shellForFixture() {
  if (process.platform !== 'win32') return 'bash';
  const { gitBash } = gitBashForWindows(repoRoot);
  assert.ok(fs.existsSync(gitBash), `Git Bash is required for the Windows fixture: ${gitBash}`);
  return gitBash;
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
  assert.match(builder, /\?embed=1&theme=dark\$\{scene\.hash\}/);
  assert.doesNotMatch(builder, /play=1|#view=/);
  assert.match(builder, /path\.relative\(from, to\)\.split\(path\.sep\)\.join\('\/'\)/);
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

test('Windows command lookup and ffmpeg launch keep their boundary diagnostics', async () => {
  const showcase = await import(pathToFileURL(path.join(repoRoot, 'scripts', 'build-readme-showcase.mjs')).href);
  const selected = String.raw`C:\Tools\ffmpeg.EXE`;
  const lookup = showcase.commandPath('ffmpeg', () => ({
    status: 0,
    stdout: `\r\n${selected}\r\nC:\\Other\\ffmpeg.exe\r\n`,
  }), 'win32');
  assert.equal(lookup, selected);
  assert.equal(showcase.commandPath('ffmpeg', () => ({
    status: 1,
    stdout: '',
    error: new Error('where failed'),
  }), 'win32'), null);
  assert.throws(
    () => showcase.launchFfmpeg(selected, ['-version'], () => ({
      status: null,
      stderr: '',
      error: Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }),
    })),
    /ffmpeg failed:\s*spawn ENOENT/,
  );
});

function fakeChrome({ exitBeforeStop = false, closeOn = null } = {}) {
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.stderr = new PassThrough();
  child.stdout = new PassThrough();
  child.stdio = [null, child.stdout, child.stderr, new PassThrough(), new PassThrough()];
  child.kill = (signal) => {
    child.signalCode = signal;
    if (closeOn === signal) {
      child.exitCode = null;
      queueMicrotask(() => child.emit('close', null, signal));
    }
    return true;
  };
  if (exitBeforeStop) {
    child.exitCode = 0;
    child.emit('close', 0, null);
  }
  return child;
}

test('showcase shutdown clears its timer and bounds a forced stop', async () => {
  const showcase = await import(pathToFileURL(path.join(repoRoot, 'scripts', 'build-readme-showcase.mjs')).href);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-showcase-profile-'));
  const started = Date.now();
  await showcase.stopChrome(fakeChrome({ exitBeforeStop: true }), profile);
  assert.ok(Date.now() - started < 1000, 'an already exited browser must not wait for the losing timer');
  fs.rmSync(profile, { recursive: true, force: true });

  const retained = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-showcase-profile-'));
  const forced = fakeChrome();
  await assert.rejects(
    () => showcase.stopChrome(forced, retained, 20),
    new RegExp(`Chrome did not exit; profile retained at ${retained.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
  );
  assert.equal(forced.signalCode, 'SIGKILL');
  assert.equal(fs.existsSync(retained), true);
  fs.rmSync(retained, { recursive: true, force: true });

  const graceful = fakeChrome({ closeOn: 'SIGTERM' });
  const gracefulStarted = Date.now();
  await showcase.stopChrome(graceful, profile);
  assert.equal(graceful.signalCode, 'SIGTERM');
  assert.ok(Date.now() - gracefulStarted < 1000, 'a prompt close must cancel the shutdown timer');
});

test('showcase navigation failure cancels its unused load waiter', async () => {
  const showcase = await import(pathToFileURL(path.join(repoRoot, 'scripts', 'build-readme-showcase.mjs')).href);
  const child = fakeChrome();
  const cdp = new showcase.PipeCdp(child);
  const loaded = cdp.waitFor('Page.loadEventFired', 'session');
  let rejected = false;
  loaded.catch(() => { rejected = true; });
  const originalWrite = child.stdio[3].write.bind(child.stdio[3]);
  child.stdio[3].write = () => { throw new Error('navigation pipe closed'); };
  await assert.rejects(() => cdp.send('Page.navigate', { url: 'about:blank' }, 'session'), /navigation pipe closed/);
  loaded.cancel();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(rejected, false);
  child.stdio[3].write = originalWrite;
  cdp.failAll(new Error('test finished'));
});

test('every README header links to the other languages', () => {
  const languageLinks = [];
  for (const { href, label } of readmeLanguages) {
    if (!languageLinks.some((entry) => entry.href === href)) languageLinks.push({ href, label });
  }
  for (const language of readmeLanguages) {
    const readme = fs.readFileSync(path.join(repoRoot, language.file), 'utf8');
    const header = readme.slice(0, sectionIndex(readme, language.file, language.demos));
    for (const { href, label } of languageLinks) {
      const anchor = `<a href="${href}"><strong>${label}</strong></a>`;
      if (href === language.href) {
        assert.ok(!header.includes(anchor), `${language.file}: header must not link its own language`);
      } else {
        assert.ok(header.includes(anchor), `${language.file}: header must link ${label} (${href})`);
      }
    }
  }
});

test('all README languages show the brand mark and localized launch video', () => {
  for (const language of readmeLanguages) {
    const filename = language.file;
    const readme = fs.readFileSync(path.join(repoRoot, filename), 'utf8');
    const markIndex = readme.indexOf('docs/assets/archify-lockup-light.svg');
    const heroPath = 'docs/assets/archify-readme-hero.png';
    const heroIndex = readme.indexOf(heroPath);
    const taglineEnd = readme.indexOf('</h3>');
    assert.equal(readme.split(heroPath).length - 1, 1, `${filename}: hero must appear exactly once`);
    assert.ok(markIndex < taglineEnd && taglineEnd < heroIndex, `${filename}: hero must follow the logo and tagline`);
    assert.ok(heroIndex < readme.indexOf('<strong>', taglineEnd), `${filename}: hero must precede navigation`);
    assert.match(readme.slice(taglineEnd + 5), /^\s*<p align="center"><img src="docs\/assets\/archify-readme-hero\.png"/);
    const proofIndex = readme.indexOf('<!-- archify-launch-video -->');
    const demosIndex = sectionIndex(readme, filename, language.demos);
    assert.ok(markIndex >= 0 && markIndex < demosIndex, `${filename}: brand lockup is missing before the demos`);
    assert.ok(proofIndex > demosIndex, `${filename}: launch video must live in the demo section`);
    const videoId = filename === 'README_ZH.md' ? '88cff7dd-bdf3-4b97-950c-37cc079898b1' : '78570807-ba1d-4737-953f-55504a378a87';
    assert.ok(readme.includes(`\nhttps://github.com/user-attachments/assets/${videoId}\n`), `${filename}: missing standalone localized video attachment`);
    assert.ok(!readme.includes('docs/assets/archify-live-proof.gif'), `${filename}: obsolete preview remains`);
    assert.match(readme, filename === 'README_ZH.md'
      ? /https:\/\/archify\.si\/zh\/gallery(?=[?#)"])/
      : /https:\/\/archify\.si\/gallery\.html/);
  }
  assert.equal(
    fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8'),
    fs.readFileSync(path.join(repoRoot, 'README_EN.md'), 'utf8'),
    'README.md and README_EN.md must stay synchronized',
  );
});

test('README installation tables contain a complete DeepSeek Harness row', () => {
  for (const { file: filename } of readmeLanguages) {
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

test('README installation tables include Hermes Agent before DeepSeek Harness', () => {
  for (const { file: filename } of readmeLanguages) {
    const readme = fs.readFileSync(path.join(repoRoot, filename), 'utf8');
    const hermes = readme.split('\n').find((line) => line.startsWith('| **Hermes Agent** |'));
    const dsh = readme.split('\n').find((line) => line.startsWith('| **DeepSeek Harness** |'));
    assert.ok(hermes, `${filename}: Hermes Agent must be an installation table row`);
    assert.ok(dsh, `${filename}: DeepSeek Harness must remain an installation table row`);
    assert.equal(
      (hermes.match(/(?<!\\)\|/g) || []).length,
      4,
      `${filename}: Hermes Agent must have exactly three table cells`,
    );
    assert.ok(hermes.includes('Node `>=18`'), `${filename}: Hermes Agent must name Node >=18`);
    assert.ok(
      hermes.includes('hermes skills install skills-sh/tt-a1i/archify/archify -y'),
      `${filename}: Hermes Agent must document the skills.sh install identifier`,
    );
    assert.ok(readme.indexOf(hermes) < readme.indexOf(dsh), `${filename}: Hermes Agent must precede DeepSeek Harness`);
  }
});

test('README demos use checked-in captures and live deep links below the existing hero', () => {
  const demos = [
    {
      asset: 'archify-demo-reach.png',
      link: 'agent-tool-call.workflow.html?theme=dark&present=1#focus=planner&reach=downstream',
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

  for (const language of readmeLanguages) {
    const filename = language.file;
    const readme = fs.readFileSync(path.join(repoRoot, filename), 'utf8');
    const markIndex = readme.indexOf('docs/assets/archify-lockup-light.svg');
    const proofIndex = readme.indexOf('<!-- archify-launch-video -->');
    const demosIndex = sectionIndex(readme, filename, language.demos);
    const quickStartIndex = sectionIndex(readme, filename, language.quickStart);
    assert.ok(markIndex >= 0 && markIndex < demosIndex, `${filename}: brand mark must precede the demos`);
    assert.ok(demosIndex < quickStartIndex, `${filename}: demo section must precede Quick start`);
    assert.ok(demosIndex < proofIndex && proofIndex < quickStartIndex, `${filename}: launch video is outside the demo section`);
    for (const demo of demos) {
      assert.match(readme, new RegExp(`docs/assets/${demo.asset.replaceAll('.', '\\.')}`));
      assert.ok(readme.includes(demo.link), `${filename}: missing ${demo.link}`);
    }
  }
});

test('README preserves the visual proof set and key content', () => {
  const commonAssets = [
    'archify-lockup-light.svg',
    'archify-lockup-dark.svg',
    'archify-readme-hero.png',
    'archify-demo-reach.png',
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

  for (const { file: filename, noRepository } of readmeLanguages) {
    const readme = fs.readFileSync(path.join(repoRoot, filename), 'utf8');
    const header = readme.slice(0, readme.indexOf(readmeLanguages.find((entry) => entry.file === filename).demos));
    for (const sponsor of [
      'https://supercode.sh/?utm_source=archify',
      'https://www.openlux.ai/register?channel=c_qdvanbpc',
      'https://www.packyapi.ai/register?aff=bN97',
      'https://www.aicodemirror.ai/register?invitecode=WC26FL',
      'https://zturbo.top',
      'https://www.infistar.cc/register?aff=9N89LEMV&amp;ref_source=link',
    ]) {
      assert.ok(header.includes(`<a href="${sponsor}">`), `${filename}: header sponsor strip must link ${sponsor}`);
    }
    assert.ok(readme.includes('<a id="sponsors"></a>'), `${filename}: sponsor section anchor is missing`);
    assert.match(readme, noRepository, `${filename}: the no-repository entry point is missing`);
    for (const asset of commonAssets) {
      assert.ok(readme.includes(`docs/assets/${asset}`), `${filename}: visual proof ${asset} was removed`);
    }
  }

});

test('all README languages end with the self-hosted star history chart', () => {
  const lightChart = 'https://raw.githubusercontent.com/tt-a1i/archify/star-history/assets/star-history-light.svg';
  const darkChart = 'https://raw.githubusercontent.com/tt-a1i/archify/star-history/assets/star-history-dark.svg';
  const workflow = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'star-history.yml'), 'utf8');

  for (const language of readmeLanguages) {
    const filename = language.file;
    const readme = fs.readFileSync(path.join(repoRoot, filename), 'utf8');
    const starHistoryIndex = readme.lastIndexOf('## Star History');
    const contributingIndex = sectionIndex(readme, filename, language.contributing);
    assert.ok(starHistoryIndex > contributingIndex, `${filename}: Star History must follow Contributing`);
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

test('Windows Git Bash discovery ignores GIT_EXEC_PATH', { skip: process.platform !== 'win32' }, () => {
  const missing = path.join(os.tmpdir(), 'archify-missing-git-exec-path');
  const normal = gitBashForWindows(repoRoot);
  for (const key of ['GIT_EXEC_PATH', 'Git_Exec_Path', 'git_exec_path']) {
    const overridden = gitBashForWindows(repoRoot, { ...process.env, [key]: missing });
    assert.equal(overridden.gitBash, normal.gitBash);
    assert.equal(fs.existsSync(overridden.gitBash), true);
    assert.equal(fs.existsSync(overridden.gitExe), true);
  }
  assert.equal(fs.existsSync(missing), false);
});

test('Star History publishing advances the data branch without a force push', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-star-history-'));
  const remote = path.join(fixture, 'remote.git');
  const firstCheckout = path.join(fixture, 'first');
  const secondCheckout = path.join(fixture, 'second');
  const publisher = path.join(repoRoot, 'scripts', 'publish-star-history.sh');

  try {
    const shell = shellForFixture();
    git(fixture, ['init', '--bare', remote]);
    git(fixture, ['--git-dir', remote, 'config', 'receive.denyNonFastForwards', 'true']);
    git(fixture, ['--git-dir', remote, 'config', 'receive.denyDeletes', 'true']);

    fs.mkdirSync(firstCheckout);
    git(firstCheckout, ['init', '-b', 'main']);
    git(firstCheckout, ['config', 'user.name', 'Fixture']);
    git(firstCheckout, ['config', 'user.email', 'fixture@example.com']);
    fs.writeFileSync(path.join(firstCheckout, 'README.md'), 'fixture\n');
    git(firstCheckout, ['add', 'README.md']);
    git(firstCheckout, ['commit', '-m', 'seed']);
    git(firstCheckout, ['remote', 'add', 'origin', remote]);
    git(firstCheckout, ['push', '-u', 'origin', 'main']);

    const firstTemp = path.join(fixture, 'run-1');
    fs.mkdirSync(firstTemp);
    writeStarHistoryCharts(firstCheckout, 'v1');
    execFileSync(shell, [publisher, 'star-history'], {
      cwd: firstCheckout,
      env: { ...process.env, RUNNER_TEMP: firstTemp },
    });
    const firstCommit = git(fixture, ['--git-dir', remote, 'rev-parse', 'refs/heads/star-history']);

    git(fixture, ['clone', '--branch', 'main', remote, secondCheckout]);
    const secondTemp = path.join(fixture, 'run-2');
    fs.mkdirSync(secondTemp);
    writeStarHistoryCharts(secondCheckout, 'v2');
    execFileSync(shell, [publisher, 'star-history'], {
      cwd: secondCheckout,
      env: { ...process.env, RUNNER_TEMP: secondTemp },
    });
    const secondCommit = git(fixture, ['--git-dir', remote, 'rev-parse', 'refs/heads/star-history']);

    assert.notEqual(secondCommit, firstCommit);
    git(fixture, ['--git-dir', remote, 'merge-base', '--is-ancestor', firstCommit, secondCommit]);
    assert.deepEqual(
      git(fixture, ['--git-dir', remote, 'ls-tree', '-r', '--name-only', secondCommit]).split('\n'),
      ['assets/star-history-dark.svg', 'assets/star-history-light.svg'],
    );
    assert.match(
      git(fixture, ['--git-dir', remote, 'show', `${secondCommit}:assets/star-history-light.svg`]),
      /light v2/,
    );
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});


test('showcase CLI runs through a filesystem alias while imports remain inert', (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-showcase-alias-'));
  t.after(() => fs.rmSync(scratch, {recursive:true, force:true}));
  const script = path.join(repoRoot, 'scripts/build-readme-showcase.mjs');
  const alias = path.join(scratch, 'showcase.mjs');
  try { fs.symlinkSync(script, alias, 'file'); }
  catch (error) {
    if (process.platform === 'win32' && ['EPERM','EACCES'].includes(error.code)) {
      t.skip('Windows host does not permit creating file symlinks'); return;
    }
    throw error;
  }
  // A deliberately empty tool search path makes actual main() fail quickly,
  // without launching a browser or generating a GIF.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'path'));
  env.PATH = '';
  const direct = spawnSync(process.execPath, [script], {env, encoding:'utf8'});
  const linked = spawnSync(process.execPath, [alias], {env, encoding:'utf8'});
  assert.equal(direct.status, 1, direct.stderr);
  assert.equal(linked.status, 1, 'alias must execute main, not silently succeed');
  assert.match(linked.stderr, /ffmpeg|Chrome or Chromium is required/);
  const imported = spawnSync(process.execPath, ['--input-type=module','--eval', `await import(${JSON.stringify(pathToFileURL(alias).href)})`], {env,encoding:'utf8'});
  assert.equal(imported.status, 0, imported.stderr);
});


test('outer capture cleanup retains a live Chrome profile and cleans ordinary failures', async () => {
  const showcase = await import(pathToFileURL(path.join(repoRoot, 'scripts/build-readme-showcase.mjs')).href);
  let retained;
  await assert.rejects(showcase.withCaptureDirectory(async root => {
    retained = root;
    const profile = path.join(root, 'profile'); fs.mkdirSync(profile);
    await showcase.stopChrome(fakeChrome(), profile, 5);
  }), /Chrome did not exit; profile retained/);
  try { assert.equal(fs.existsSync(path.join(retained, 'profile')), true); }
  finally { fs.rmSync(retained, {recursive:true, force:true}); }
  let removed;
  const original = new Error('capture failed');
  await assert.rejects(showcase.withCaptureDirectory(async root => {removed=root; throw original;}), error => error===original);
  assert.equal(fs.existsSync(removed), false);
});
