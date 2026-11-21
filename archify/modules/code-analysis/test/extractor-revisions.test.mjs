// Extractor revisions: when an adapter's output for fixed sources changes, its
// REVISION must be decided, so comparisons across the change report
// adapter-changed instead of presenting extraction changes as code changes.
// See docs/TECH-GUIDE.md, "Extractor revisions".
//
// To record a deliberate change, decide the revision first, then run:
//   UPDATE_EXTRACTOR_REVISIONS=1 node --test test/extractor-revisions.test.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { extractFacts, loadConfig, stableJson } from '../lib/analysis.mjs';
import { schemaErrors } from '../extract/shared/schema.mjs';
import { REVISION as TS_REVISION } from '../extract/ts/index.mjs';
import { REVISION as PY_REVISION } from '../extract/py/index.mjs';
import { REVISION as JAVA_REVISION } from '../extract/java/index.mjs';
import { MODULE_ROOT } from './helpers.mjs';

const FIXTURES = path.join(MODULE_ROOT, 'test', 'fixtures');
const LOCK = path.join(FIXTURES, 'extractor-revisions.json');
const ADAPTERS = [
  { language: 'ts', fixture: 'ts-basic', revision: TS_REVISION, source: 'extract/ts/index.mjs' },
  { language: 'py', fixture: 'py-basic', revision: PY_REVISION, source: 'extract/py/index.mjs' },
  { language: 'java', fixture: 'java-basic', revision: JAVA_REVISION, source: 'extract/java/index.mjs' },
];
const UPDATE = process.env.UPDATE_EXTRACTOR_REVISIONS === '1';

// What extraction decided, without what depends on the checkout: the repository
// block (paths, Git state, parser and runtime versions, snapshot id), captured
// source text (line endings) and parse error wording (it comes from the parser
// or Python version, which `adapter` already records).
function extractionDigest(facts) {
  const { repository: _repository, files, parse_errors: parseErrors, ...rest } = facts;
  const output = {
    ...rest,
    files: files.map(({ sourceText: _sourceText, ...file }) => file),
    ...(parseErrors ? { parse_errors: parseErrors.map((e) => e.path) } : {}),
  };
  return createHash('sha256').update(stableJson(output)).digest('hex');
}

const lock = JSON.parse(fs.readFileSync(LOCK, 'utf8'));
const recorded = {};

for (const adapter of ADAPTERS) {
  test(`extractor revision: ${adapter.language} output on ${adapter.fixture} matches its recorded revision`, () => {
    const { facts } = extractFacts(path.join(FIXTURES, adapter.fixture), { language: adapter.language, config: loadConfig(null) });
    assert.deepEqual(schemaErrors('raw-facts', facts), []);
    assert.equal(facts.repository.adapterRevision, adapter.revision, 'raw facts record the adapter REVISION');
    const current = { revision: adapter.revision, digest: extractionDigest(facts) };
    recorded[adapter.language] = { fixture: adapter.fixture, ...current };
    if (UPDATE) return;
    const expected = lock[adapter.language];
    assert.ok(expected, `no entry for ${adapter.language} in ${path.relative(MODULE_ROOT, LOCK)}`);
    if (current.digest !== expected.digest && current.revision === expected.revision) {
      assert.fail([
        `The ${adapter.language} extractor's output on test/fixtures/${adapter.fixture} changed, but REVISION is still ${current.revision}.`,
        `If the adapter's logic changed, bump REVISION in ${adapter.source}; if only the fixture changed, keep it.`,
        'Then record the result with UPDATE_EXTRACTOR_REVISIONS=1 (see docs/TECH-GUIDE.md, "Extractor revisions").',
      ].join('\n'));
    }
    assert.deepEqual(current, { revision: expected.revision, digest: expected.digest },
      `record ${adapter.language} revision ${current.revision} with UPDATE_EXTRACTOR_REVISIONS=1`);
  });
}

if (UPDATE) {
  test('extractor revision: record the current revisions and digests', () => {
    assert.equal(Object.keys(recorded).length, ADAPTERS.length, 'every adapter ran');
    const next = Object.fromEntries(ADAPTERS.map((a) => [a.language, recorded[a.language]]));
    fs.writeFileSync(LOCK, `${JSON.stringify(next, null, 2)}\n`);
  });
}
