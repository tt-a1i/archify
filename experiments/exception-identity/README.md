# Exception identity experiment

[Open the native Architecture](exception-identity.html). Three objects have three relationships: `outer contains inner`, `inner contains leaf`, and `inner caused-by outer`. Python prints `inner` and `leaf` twice in this deliberately constructed case. Printed repetition does not mean new objects or a second run.

This is an original **synthetic deliberate fixture**, not a production incident. It tests a content hypothesis: a small native graph can distinguish group membership from explicit cause while preserving object identity. It does not measure reader comprehension or authoring speed and proposes no runtime, schema, installation, or parser changes.

## Reproduce

From the repository root, with Python >=3.11, Node >=22.13, the root dependencies and Chrome available:

```sh
ARCHIFY_NODE=node python3 experiments/exception-identity/reproduce.py
```

This runs only the checked-in fixture, five live-object semantic tests, the existing CLI's complete showcase `finalize`, and strict-provenance `visual-check`. No source string or traceback is executed or parsed. `ARCHIFY_NODE` may select an existing supported Node executable. For a checkout without dependencies, `npm ci --ignore-scripts` at the root supplies its existing lockfile dependencies; this is not a live Skill install.

The fixture catches one ordinary ValueError, nests it in two groups, and raises the inner group explicitly from the outer group. It reads only those three known objects. Its stable symbols are fixture-local names, not memory addresses, event IDs or cross-run identities. The graph is an object relationship map, not call order, retry flow or a claim of recursive execution.

## Evidence and limits

- `fixture.py` is the original construction and direct object-property observation. `evidence/observation.json` records the actual Python version, identity checks, relationship kinds and printed-line counts.
- `evidence/traceback.txt` is actual stdlib formatter output from this run. Only this fixture's absolute filename is replaced by `fixture.py`; line numbers and formatter text are preserved. Raw unnormalized output remains ignored under `raw/`. No frame locals are captured.
- `test_fixture.py` compares the native model to live `exceptions` and `__cause__` properties using `is`, independently of the JSON observation. Deliberately mislabeled cause, reversed cause and duplicated node mutations must fail. Printed-count assertions cover this fixture on the tested interpreter; formatting is not promised across every Python release.
- `evidence/latest-run.json` is a portable summary, explicitly **not** an original provenance receipt. Full stdout/stderr and original CLI receipts remain in ignored `raw/run-*`; rerunning creates a new evidence directory. The artifact and four screenshots are committed for review.
- `drafts/first-candidate.json`, its first light screenshot and first-stage summaries preserve the first attempt. The first draft passed all automated gates. Screenshot inspection found the synthetic scope and printed multiplicity too dependent on cards below the fold; the final title and node sublabels surface them. An intermediate tag-only change was invisible in READ view and was replaced by visible sublabels. No failed command is hidden.

Observed environment: Python **3.13.16**, Node **22.23.3**, existing Archify **3.2.1-dev.1** at base `e837dc4cb83042d2b6c596e039692e25ec62c2da`. The fixture itself requires only stdlib Python >=3.11. Native finalize and four light/dark captures passed. Agent screenshot inspection checks the diagram and labels; independent browser inspection remains separate. Supporting cards are below the first viewport, so the core reading must stand on the title, labels and native graph. No claims about full-page visual acceptance, production use, cross-version validation or human acceptance.

## Sources and license provenance

Freshly inspected on 2026-10-27:

- Inspiration: agronholm/exceptiongroup [`test_exceptiongroup_loop`](https://github.com/agronholm/exceptiongroup/blob/8ee4bfcf7d6706ac6328c2e7a3840556180099de/tests/test_formatting.py#L141-L176), fixed commit `8ee4bfcf7d6706ac6328c2e7a3840556180099de`. This experiment has new names, an actually caught ordinary error, direct identity observations and native output; no upstream implementation, expected-output template or test text is copied. GitHub UI and raw views may report different line numbering; locate the named function.
- The complete upstream [LICENSE](https://github.com/agronholm/exceptiongroup/blob/8ee4bfcf7d6706ac6328c2e7a3840556180099de/LICENSE) was freshly read: MIT plus the PSF License Version 2 notice for copied stdlib portions. It is not described as MIT-only. This experiment uses URL attribution and original code rather than vendoring either library.
- Primary semantics: [Python 3.11 exception context](https://docs.python.org/3.11/library/exceptions.html#exception-context), [ExceptionGroup](https://docs.python.org/3.11/library/exceptions.html#ExceptionGroup), and [stdlib traceback](https://docs.python.org/3.11/library/traceback.html). These support the distinction between child exceptions, explicit cause and formatted display. The local run establishes the recorded output; documentation is not presented as a captured run.

AI assistance: Codex / GPT-6.1 Sol authored this isolated experiment and ran automated checks and screenshot inspection. Human approval and product acceptance have not been claimed.
