// Adapted from github/codeql-action src/fingerprints.ts, commit 592d162b.
// Copyright (c) 2020 GitHub. MIT; see vendor/CODEQL-LICENSE.txt.
// Hashes are match anchors, not proof of unchanged source or semantic equality.
const BLOCK_SIZE = 100;
const MOD = 37n;
const FIRST_MOD = BigInt.asUintN(64, MOD ** BigInt(BLOCK_SIZE));

export function lineFingerprints(text) {
  const window = Array(BLOCK_SIZE).fill(0);
  const lineNumbers = Array(BLOCK_SIZE).fill(-1);
  const hashes = new Map(), counts = new Map();
  let raw = 0n, index = 0, lineNumber = 0, lineStart = true, previousCR = false;
  const output = () => {
    const value = raw.toString(16), count = (counts.get(value) || 0) + 1;
    counts.set(value, count);
    hashes.set(lineNumbers[index], `${value}:${count}`);
    lineNumbers[index] = -1;
  };
  const update = current => {
    const begin = window[index];
    window[index] = current;
    raw = BigInt.asUintN(64, MOD * raw + BigInt(current) - FIRST_MOD * BigInt(begin));
    index = (index + 1) % BLOCK_SIZE;
  };
  const process = value => {
    if (value === 32 || value === 9 || (previousCR && value === 10)) { previousCR = false; return; }
    if (value === 13) { value = 10; previousCR = true; } else previousCR = false;
    if (lineNumbers[index] !== -1) output();
    if (lineStart) { lineStart = false; lineNumbers[index] = ++lineNumber; }
    if (value === 10) lineStart = true;
    update(value);
  };
  for (let i = 0; i < text.length; i++) process(text.charCodeAt(i));
  process(65535);
  for (let i = 0; i < BLOCK_SIZE; i++) { if (lineNumbers[index] !== -1) output(); update(0); }
  return hashes;
}
