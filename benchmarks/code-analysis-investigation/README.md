# Reliable investigation: public replay

This fixed-case evaluation fetches seven public projects at exact commits, runs Archify's normal CLI from both a Git checkout and the committed `archify.zip` from the same revision, grades frozen units and compares outputs. It does not run the target projects. The analyzer is executed; `npm ci --ignore-scripts` in each `archify/modules/code-analysis` directory installs its locked dependencies with package lifecycle scripts disabled. Network access to GitHub and npm is required.

## Prerequisites and execution

Install Git, Node **22.23.2**, npm and Python **3.13** yourself and put them on `PATH`. The recorded run used Python 3.13.16. The harness refuses other Node versions or Python minor versions. It does not install runtimes. Allow disk space for 12 Git checkouts and analysis outputs. Exact commit fetches require GitHub to serve the pinned objects.

```sh
python3.13 replay.py --revision python --work /path/to/new-replay --prepare-only
python3.13 replay.py --revision python --work /path/to/new-replay
```

`--work` must not already exist; each full run starts fresh. Options are `labs`, `combined`, `python`, and `paired`, pinned in the script. The `paired` revision is pinned to the publicly available predecessor `92606d7e8d1a55a800c0ee0ea34753630682c0f5`. Its committed ZIP digest is also pinned; both modes must meet the frozen paired contract: Redux, Commander, HTTPX and Pluggy ready with exit 0; SLF4J exit 1/incomplete with precisely one known parse-error file per side, available selected definition coverage and both partial-coverage reasons. All eight selected changed definitions and four outgoing imports must score correct. Use `--require-paired-contract` to apply that gate to another revision. The script checks source commits, tracked cleanliness and selected source hashes before and after analysis, validates bundled inputs, then writes preflight, CLI output, captures, unit grades and a source-versus-archive comparison under the work directory. A failed preflight, missing file, differing result or missing expected comparison output exits nonzero. Do not treat a partial directory as a completed run.

Comparison checks all 27 command arguments, exits and receipt statuses, and requires 12 raw fact files to match byte-for-byte. Ten saved-question and five paired results must match after replacing only `rawFactsPath` and absolute `workflow` paths. For older versions, a missing result is accepted only when both sides return the same explicit unsupported-option usage error or, for the three specified Python/Java paired entries, the matching JS/TS-only entry rejection. A pass is equality between packaging modes, not proof of correctness.

## Oracle and limits

`provenance.json` records SHA-256 hashes of the original private inputs and the public copies. Private filesystem paths and references were replaced by source placeholders or omission markers; frozen expected semantic values and source-file digests were retained. At runtime only declared source-root paths are relocated. The original oracles were not overwritten. Supplemental and outgoing oracle copies retain their original byte hashes. The original freeze program and private reference documents are not distributed; their hashes provide provenance, not independent public access to those documents.

The source-first atomic units were enumerated after prior analyzer exposure; this is **not a blind benchmark**. Supplemental definition spans and selected outgoing imports were frozen before paired candidate verification, also after previous product studies. Original questions had earlier source-first answers, but their private evidence is not included here. Results cover only selected units and do not establish completeness or performance on other repositories. Inspect `unit-results.json` and raw evidence, including omissions and explicit unknowns, rather than treating aggregate counts as general accuracy.

A [complete public-fetch replay](PUBLIC-REPLAY.md) at `919dc11f807484754fddcb707fd98fbfb3951c89` passed from source and committed ZIP, using 12 newly fetched target checkouts. Both adversarial graders, the strict paired contract and output equivalence passed. See the [acceptance report](FINAL-REPORT.md) for before/after results and limitations.

SLF4J’s known parse-error file is `slf4j-migrator/jcl/jclcontent.java`, line 19, column 1, on both sides. It is an example intended for conversion, with top-level assignment statements. Its failure makes the full capture partial even though the selected entry definitions are available. The gate preserves that limitation and rejects other partial-coverage causes.

## Replaying another exact product commit

Use `--product-sha <40-character commit> --archive-sha256 <64-character digest>` to run a different fetchable commit with its exact committed archive, and `--require-paired-contract` to apply the frozen predecessor gate. The override does not change the oracle or pin an unknown future revision. A local-only commit must first be made fetchable from the configured Archify remote, or evaluated separately against the same inputs with the local checkout and archive documented in its receipt. The original questions and their runtime answers are context, not automatic recovery scores.

### Versioned Java call availability

The frozen predecessor contract expected Java paired-call data to be unavailable. `unit-results.json` preserves that original predicate as `historical_contract_result`, but reports the two availability assertions separately from target-unit `summary`. A matching Java producer with `java-static-lexical-v1` and structurally consistent available coverage is `contract-expanded`; an unrecognized model must remain explicitly unavailable. Missing or contradictory coverage is `contract-violation`. Availability and its counts do not establish whether any target is correct. This distinction prevents a newly available capability from being presented as a wrong call target while preserving the old result for audit.

The separate `benchmarks/code-analysis-java-calls/oracle.json` (SHA-256 `bc61d7769560713d87314233178db08cc7827aea5e48733d8a5991900eb6e622`) independently defines the 86 selected Java invocation cases; use that benchmark to assess their targets. Its source-first scope and limitations are described in its own README. The availability grader can be checked with a saved modern SLF4J paired result:

```sh
python3.13 evaluation/test_java_availability.py /path/to/outputs/source/paired-slf4j/result.json
```

| Availability result | Meaning |
| --- | --- |
| `contract-expanded` | Recognized Java model reports consistent available fields; targets are not scored here. |
| `explicit-unknown` | Unrecognized model retains unavailable coverage and unknown totals. |
| `contract-violation` | Producer, model, side or coverage fields contradict the applicable contract. |
| `omitted` | The selected result or records are absent. |
