import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

for (const autocrlf of ['true', 'input', 'false']) {
  test(`Git checkout preserves committed text and binary bytes with core.autocrlf=${autocrlf}`, () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-checkout-eol-'));
    const source = path.join(fixture, 'source');
    const checkout = path.join(fixture, 'checkout');
    // Ignore caller Git configuration, attributes, repository paths, and signing hooks.
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
    Object.assign(env, {
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: os.devNull,
      GIT_ATTR_NOSYSTEM: '1',
    });
    const runGit = (cwd, args) => {
      const result = spawnSync('git', ['-c', `core.attributesFile=${os.devNull}`, ...args], {
        cwd, env, timeout: 30_000,
      });
      assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.error || result.stderr}`);
      return result.stdout;
    };

    try {
      fs.mkdirSync(source);
      runGit(source, ['init', '--quiet', '--template=']);
      runGit(source, ['config', 'core.autocrlf', 'false']);
      runGit(source, ['config', 'user.name', 'Archify Test']);
      runGit(source, ['config', 'user.email', 'archify@example.invalid']);
      const files = new Map([
        ['.gitattributes', fs.readFileSync(path.join(repoRoot, '.gitattributes'))],
        ['README.md', Buffer.from('# Checkout proof\n文本 stays LF.\n')],
        ['archify/bin/example.mjs', Buffer.from('export const value = 1;\n')],
        ['examples/proof.html', Buffer.from('<!doctype html>\n<p>diagram</p>\n')],
        ['scripts/proof.sh', Buffer.from('#!/bin/sh\nprintf "proof"\n')],
        // NUL identifies binary data; embedded CRLF must remain byte-for-byte intact.
        ['archify.zip', Buffer.from([0x50, 0x4b, 3, 4, 0, 13, 10, 0xff])],
        ['docs/assets/proof.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 0, 0xff])],
      ]);
      for (const [relative, bytes] of files) {
        const target = path.join(source, relative);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, bytes);
      }
      runGit(source, ['add', '--all']);
      runGit(source, ['-c', 'commit.gpgSign=false', 'commit', '--quiet', '-m', 'checkout fixture']);
      runGit(fixture, ['clone', '--quiet', '--no-checkout', '--no-hardlinks', '--template=', source, checkout]);
      runGit(checkout, ['config', 'core.autocrlf', autocrlf]);
      runGit(checkout, ['config', 'core.eol', 'crlf']);
      runGit(checkout, ['checkout', '--quiet', '--detach', 'HEAD']);

      for (const [relative, expected] of files) {
        const committed = runGit(checkout, ['show', `HEAD:${relative}`]);
        assert.deepEqual(committed, expected, `${relative}: staging must not rewrite fixture bytes`);
        assert.deepEqual(fs.readFileSync(path.join(checkout, relative)), committed,
          `${relative}: checkout bytes must equal committed bytes`);
      }
      assert.equal(runGit(checkout, ['status', '--porcelain']).toString().trim(), '');
      assert.equal(runGit(checkout, ['check-attr', 'linguist-generated', '--', 'examples/proof.html'])
        .toString().trim(), 'examples/proof.html: linguist-generated: true');
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  });
}
