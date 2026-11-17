# Python rewrite validation

Recorded 2026-11-17 on Node 20.20.2, macOS. Candidate branch:
`codex/python-pyright-source`, based on `labs/code-analysis` commit
`772b2dea12381ed87916dc811b3767f1d8bc3eb5`. Evidence was collected on the
working-tree candidate before its initial commit; the analyzer digest below
pins the tested implementation for reuse during PR preparation.

Generated analyzer SHA256:
`3083bf67e094c545a367b201234156d1ad9f6c0a00940e96885a0024a4a295a1`.

| Check | Result |
| --- | --- |
| `npm run check:python` | Passed: reproducible bundle, TypeScript, upstream local hashes and retained MIT license |
| Full module `npm test` | 649 tests: 633 passed, 16 real-jscpd tests initially skipped because the executable was not configured |
| Real jscpd 5.4.3 supplement | All 26 tests across duplicate-coordinates, duplicate-languages, duplicate-workflow and duplicates passed, with zero skips; includes all 16 omitted native checks |
| Root `npm test` | All 19 core product smoke tests passed |
| Root `npm run test:generated` | All viewer, brand-mark, validator, release-identity and golden checks passed |
| Public CLI exposure | Passed, including the public Code Analysis command surface |
| Candidate package staging | All 5 selected package-smoke/staging tests passed using a temporary Git index containing the new/deleted paths; the working index was not changed |
| Fixed Click reference | 447 selected targets agree with frozen Pyright source definitions; no disagreements; 204 previous targets retained unchanged; manual oracle 19/19 |
| Baseline fact comparison | Function, import and symbol facts identical; all 2,027 call positions identical |
| `git diff --check` | Passed |

The complete module run plus the native supplement covers all 649 module tests.
The supplement used the same pinned native tool as CI:

```sh
ARCHIFY_TEST_JSCPD=/path/to/jscpd-5.4.3/node_modules/.bin/jscpd \
  node --test test/duplicate-coordinates.test.mjs test/duplicate-languages.test.mjs \
    test/duplicate-workflow.test.mjs test/duplicates.test.mjs
```

Python checks include the 70 target/feature syntax combinations, a process with
empty PATH and an invalid Python executable override, scope/receiver negatives,
UTF-16/range hashes, PEP 263/BOM/Windows-1252 decoding, historical model readers,
and 3,500-term arithmetic/boolean chains with preserved import guards.

The original Node 20 run established staging/smoke coverage. During PR
preparation, the archive was also rebuilt with official **Node 22.23.2** and
bundled zlib **1.3.1-e00f703**, and checked with a second deterministic build.
The extracted archive passed `scripts/package-smoke.mjs`; its bundled Python
parser separately accepted modern generic/default/template-string syntax with
an empty PATH and no Python executable. The parser/type/provenance check and
31 focused Python/history/revision tests were rerun with the canonical Node 22
runtime. The analyzer digest above is unchanged from the implementation commit
`22fd845fd3b05d00a77db2e2de73ff9aed72d965`.

These are local macOS results. Remote CI, Linux/Windows packaging and release
acceptance remain separate evidence.

See [the implementation and bounds](../PYTHON.md) and
[the frozen real-project result](python-click-8.5.1.json).
