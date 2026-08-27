import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function trackedFilesConvertedToCrlf() {
  const output = execFileSync('git', ['ls-files', '--eol'], { cwd: repoRoot, encoding: 'utf8' });
  return output
    .split('\n')
    .filter((line) => /\bw\/crlf\b/.test(line))
    .map((line) => line.slice(line.indexOf('\t') + 1).trim());
}

test('tracked text files check out as LF so working-tree bytes match the index', () => {
  const converted = trackedFilesConvertedToCrlf();
  assert.deepEqual(
    converted,
    [],
    `checked out with CRLF, so these no longer match their committed bytes and cannot be compared against renderer output or staged into archify.zip:\n${converted.join('\n')}`,
  );
});
