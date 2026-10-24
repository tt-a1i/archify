import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  avatarMediaType,
  buildContributorsSvg,
  displayLogin,
  fetchContributors,
  isBotContributor,
  renderContributorsSvg,
} from '../scripts/generate-contributors-svg.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publisher = path.join(repoRoot, 'scripts', 'publish-contributors-svg.sh');
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const dataUri = `data:image/png;base64,${png.toString('base64')}`;

function person(login, contributions, avatar = dataUri) {
  return { login, contributions, dataUri: avatar };
}

function rowCounts(svg) {
  const counts = new Map();
  for (const match of svg.matchAll(/transform="translate\([0-9.]+ ([0-9.]+)\)"/g)) {
    counts.set(match[1], (counts.get(match[1]) || 0) + 1);
  }
  return [...counts.values()];
}

function jsonResponse(body, { link, status = 200 } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (link) headers.link = link;
  return new Response(JSON.stringify(body), { status, headers });
}

test('bot accounts stay off the wall and human logins stay on it', () => {
  assert.equal(isBotContributor({ login: 'github-actions[bot]', type: 'Bot' }), true);
  assert.equal(isBotContributor({ login: 'dependabot[bot]', type: 'Bot' }), true);
  assert.equal(isBotContributor({ login: 'claude', type: 'User' }), true);
  assert.equal(isBotContributor({ login: 'Claude', type: 'User' }), true);
  assert.equal(isBotContributor({ login: 'renovate[bot]', type: 'Bot' }), true);
  assert.equal(isBotContributor({ login: 'custom-release[bot]', type: 'User' }), true);
  assert.equal(isBotContributor({ login: 'some-app', type: 'Bot' }), true);
  assert.equal(isBotContributor({ login: 'claudette', type: 'User' }), false);
  assert.equal(isBotContributor({ login: 'robotics', type: 'User' }), false);
  assert.equal(isBotContributor({ login: 'ada', type: 'User' }), false);
});

test('the wall is a 1000px grid of eight circular inline avatars', () => {
  const longLogin = 'a'.repeat(39);
  const people = Array.from({ length: 9 }, (_, index) => person(index === 8 ? longLogin : `user${index}`, 9 - index));
  const svg = renderContributorsSvg(people);
  assert.match(svg, /<svg[^>]*\swidth="1000"/);
  assert.deepEqual(rowCounts(svg), [8, 1]);
  assert.equal([...svg.matchAll(/<image\b[^>]*width="72"[^>]*height="72"/g)].length, 9);
  assert.equal([...svg.matchAll(/<clipPath id="archify-contributor-\d+"><circle[^>]*r="36"/g)].length, 9);
  assert.equal([...svg.matchAll(/clip-path="url\(#archify-contributor-\d+\)"/g)].length, 9);
  assert.equal([...svg.matchAll(/data:image\/png;base64,/g)].length, 9);
  assert.match(svg, /prefers-color-scheme:\s*dark/);
  assert.match(svg, /\.name \{ fill: #24292f;/);
  assert.match(svg, /fill: #f0f6fc;/);
  assert.match(svg, new RegExp(`<title>${longLogin}</title>`));
  assert.match(svg, new RegExp(`<text class="name"[^>]*>${displayLogin(longLogin)}</text>`));
  assert.equal([...svg.matchAll(new RegExp(longLogin, 'g'))].length, 1);
  assert.throws(() => renderContributorsSvg([]), /No human contributors/);
  assert.throws(() => renderContributorsSvg([person('ada', 1, 'https://example.test/a.png')]), /inline avatar/);
});

test('contributor fetching keeps humans, follows GitHub pagination, and refuses other hosts', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (String(url).includes('page=2')) {
      return jsonResponse([
        { login: 'ada', type: 'User', contributions: 4, avatar_url: 'https://avatars.githubusercontent.com/u/3' },
        { login: 'grace', type: 'User', contributions: 4, avatar_url: 'https://avatars.githubusercontent.com/u/4' },
      ]);
    }
    return jsonResponse([
      { login: 'github-actions[bot]', type: 'Bot', contributions: 90, avatar_url: 'https://avatars.githubusercontent.com/u/1' },
      { login: 'claude', type: 'User', contributions: 20, avatar_url: 'https://avatars.githubusercontent.com/u/2' },
      { login: 'ada', type: 'User', contributions: 4, avatar_url: 'https://avatars.githubusercontent.com/u/3' },
      { login: 'linus', type: 'User', contributions: 2, avatar_url: 'https://avatars.githubusercontent.com/u/5' },
    ], {
      link: '<https://api.github.com/repos/tt-a1i/archify/contributors?per_page=100&page=2>; rel="next"',
    });
  };

  const people = await fetchContributors({ repo: 'tt-a1i/archify', fetchImpl });
  assert.deepEqual(people.map((person) => person.login), ['ada', 'grace', 'linus']);
  assert.equal(calls.length, 2);

  const hostile = async () => jsonResponse([], {
    link: '<https://evil.example/contributors>; rel="next"',
  });
  await assert.rejects(
    () => fetchContributors({ repo: 'tt-a1i/archify', fetchImpl: hostile }),
    /api\.github\.com/,
  );
  await assert.rejects(
    () => fetchContributors({
      repo: 'tt-a1i/archify',
      fetchImpl: async () => jsonResponse([{ login: 'dependabot[bot]', type: 'Bot', contributions: 1 }]),
    }),
    /No human contributors/,
  );
});

test('avatar bytes are inlined only from GitHub image responses', async () => {
  assert.equal(avatarMediaType(png, 'application/octet-stream'), 'image/png');
  const svg = await buildContributorsSvg({
    repo: 'tt-a1i/archify',
    fetchImpl: async (url) => {
      if (String(url).includes('/contributors')) {
        return jsonResponse([
          { login: 'ada', type: 'User', contributions: 2, avatar_url: 'https://avatars.githubusercontent.com/u/3?v=4' },
          { login: 'claude', type: 'User', contributions: 9, avatar_url: 'https://avatars.githubusercontent.com/u/2' },
        ]);
      }
      assert.match(String(url), /^https:\/\/avatars\.githubusercontent\.com\/u\/3\?/);
      assert.match(String(url), /(?:\?|&)s=144(?:&|$)/);
      return new Response(png, { status: 200, headers: { 'content-type': 'image/png' } });
    },
  });
  assert.match(svg, /<title>ada<\/title>/);
  assert.equal(svg.includes('claude'), false);
  assert.match(svg, /data:image\/png;base64,/);
});

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

test('contributors publishing fast-forwards a data branch and refuses main or dev', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-contributors-'));
  const remote = path.join(fixture, 'remote.git');
  const firstCheckout = path.join(fixture, 'first');
  const secondCheckout = path.join(fixture, 'second');
  const shell = 'bash';
  const writeSvg = (file, label) => fs.writeFileSync(file, `<svg xmlns="http://www.w3.org/2000/svg"><title>${label}</title></svg>\n`);

  try {
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
    const mainCommit = git(firstCheckout, ['rev-parse', 'HEAD']);

    const firstSvg = path.join(fixture, 'wall-1.svg');
    const sameSvg = path.join(fixture, 'wall-1-copy.svg');
    writeSvg(firstSvg, 'v1');
    writeSvg(sameSvg, 'v1');
    const firstTemp = path.join(fixture, 'run-1');
    fs.mkdirSync(firstTemp);
    execFileSync(shell, [publisher, 'contributors', firstSvg], {
      cwd: firstCheckout,
      env: { ...process.env, RUNNER_TEMP: firstTemp },
    });
    const firstCommit = git(fixture, ['--git-dir', remote, 'rev-parse', 'refs/heads/contributors']);
    assert.equal(git(fixture, ['--git-dir', remote, 'rev-parse', 'refs/heads/main']), mainCommit);

    git(fixture, ['clone', '--branch', 'main', remote, secondCheckout]);
    const sameTemp = path.join(fixture, 'run-same');
    fs.mkdirSync(sameTemp);
    const unchanged = spawnSync(shell, [publisher, 'contributors', sameSvg], {
      cwd: secondCheckout,
      env: { ...process.env, RUNNER_TEMP: sameTemp },
      encoding: 'utf8',
    });
    assert.equal(unchanged.status, 0, unchanged.stderr);
    assert.equal(git(fixture, ['--git-dir', remote, 'rev-parse', 'refs/heads/contributors']), firstCommit);
    assert.match(unchanged.stdout, /unchanged/);

    const secondSvg = path.join(fixture, 'wall-2.svg');
    writeSvg(secondSvg, 'v2');
    const secondTemp = path.join(fixture, 'run-2');
    fs.mkdirSync(secondTemp);
    execFileSync(shell, [publisher, 'contributors', secondSvg], {
      cwd: secondCheckout,
      env: { ...process.env, RUNNER_TEMP: secondTemp },
    });
    const secondCommit = git(fixture, ['--git-dir', remote, 'rev-parse', 'refs/heads/contributors']);
    assert.notEqual(secondCommit, firstCommit);
    git(fixture, ['--git-dir', remote, 'merge-base', '--is-ancestor', firstCommit, secondCommit]);
    assert.deepEqual(
      git(fixture, ['--git-dir', remote, 'ls-tree', '-r', '--name-only', secondCommit]).split('\n'),
      ['contributors.svg'],
    );
    assert.match(
      git(fixture, ['--git-dir', remote, 'show', `${secondCommit}:contributors.svg`]),
      /v2/,
    );
    assert.equal(git(fixture, ['--git-dir', remote, 'rev-parse', 'refs/heads/main']), mainCommit);

    for (const branch of ['main', 'dev']) {
      const refused = spawnSync(shell, [publisher, branch, secondSvg], {
        cwd: secondCheckout,
        encoding: 'utf8',
      });
      assert.notEqual(refused.status, 0, branch);
      assert.match(refused.stderr, new RegExp(branch));
    }
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});

test('the contributors workflow publishes the data branch instead of main or dev', () => {
  const workflow = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'contributors.yml'), 'utf8');
  assert.match(workflow, /^name: Contributors/m);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /schedule:/);
  assert.match(workflow, /cron: '15 5 \* \* 1'/);
  assert.match(workflow, /permissions:\n  contents: write/);
  assert.match(workflow, /actions\/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09/);
  assert.match(workflow, /actions\/setup-node@a0853c24544627f65ddf259abe73b1d18a591444/);
  assert.match(workflow, /node-version: 22/);
  assert.match(workflow, /node scripts\/generate-contributors-svg\.mjs --out "\$RUNNER_TEMP\/contributors\.svg"/);
  assert.match(workflow, /bash scripts\/publish-contributors-svg\.sh contributors "\$RUNNER_TEMP\/contributors\.svg"/);
  assert.doesNotMatch(workflow, /branches:\s*\[(?:main|dev)/);
  assert.doesNotMatch(workflow, /git-auto-commit-action|git commit|git push/);
});
