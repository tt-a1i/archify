# Java call evidence benchmark

This benchmark compares the public `code-analysis check` and `task` CLI output with a frozen source-first oracle for 86 invocation sites in eight selected methods. It is a small, deliberately chosen sample, not a project-wide accuracy estimate. It does not execute the target projects.

## Oracle and evidence

`oracle.json` is a sanitized copy of the source-first `manifest-v2.json` (original SHA-256 `6814a449f9bf91962bcebe179e57467654a1efef8f4d77f528bbb3ae20182a1d`). It removes local paths and source excerpts; the source commits, file hashes, identities, UTF-16 end-exclusive JDK invocation and selected declaration offsets, expected target identities and boundary decisions are retained. The bundled copy's SHA-256 is `bc61d7769560713d87314233178db08cc7827aea5e48733d8a5991900eb6e622`.

The original inventory was frozen before analyzer runs: javac 17 identified all 86 sites. Of 26 expected targets, 21 SLF4J targets were compiler-attributed across the API sources; five Guava targets were identified from source under a parse-only compiler run. The remaining 60 sites were outside the bounded target oracle and are not binding true positives. Java compiler diagnostics and other original artifacts were retained in the study, but are not included in this sanitized package.

The original oracle records target method header lines but not full target declaration ranges. The harness therefore generates a supplemental javac declaration inventory from the pinned source before invoking the analyzer, saves the inventory and its digest, and uses full declaration ranges and declaration-slice SHA-256 to check target facts. This supplement was first added after the original captures, so it is additional source evidence rather than part of the original freeze. The saved candidate result was regraded after two grader corrections: an annotation may precede the header line, and JSON serializes coordinate tuples as lists. Initial results were retained separately in the study. The packaged per-method summaries reflect the corrected regrade.

An exact binding requires the exact invocation range, a complete caller identity and range, the matching target signature and full declaration range/digest, and the expected same-file target coordinates. Navigation is counted separately and requires available question coverage, matching selection and raw fact, and valid target navigation. Explicit unresolved calls are counted separately; the oracle does not establish whether a target supplied for an unknown-boundary site is right or wrong. Missing calls, extra calls, wrong bindings and unavailable question coverage remain visible. This does not establish runtime dispatch, execution, or general accuracy across other Java syntax.

## Reproduce

Use Python 3, Node 22.23.2 and a JDK 17 `java`/`javac`. Fetch the pinned repositories into three separate clean checkouts:

```sh
git clone https://github.com/qos-ch/slf4j.git slf4j-base
git -C slf4j-base checkout --detach aa13da39edd4195c25eecb1263c4bf3f8902a3e4
git clone https://github.com/qos-ch/slf4j.git slf4j-head
git -C slf4j-head checkout --detach 9783320b6c4411a0b120cad9e32cd9a981b1dac2
git clone https://github.com/google/guava.git guava-head
git -C guava-head checkout --detach f06690fa3e874f65515e8fd338a74d636e2c792f
```

Use separate clean Archify checkouts at baseline `7fa882747cda2fc150c120b62a039c6d783d1ccf` and candidate `d9ab19812a5ccf119a0d7e95e8d89accaa5fb025`, with the Code Analysis module dependencies installed in each checkout. Run the harness from this benchmark directory; replace the placeholders with absolute paths:

```sh
python3 run.py --self-check
python3 run.py --cli /path/to/baseline/archify/bin/archify.mjs --name baseline --product-sha 7fa882747cda2fc150c120b62a039c6d783d1ccf --slf4j-base /path/to/slf4j-base --slf4j-head /path/to/slf4j-head --guava /path/to/guava-head --output /path/to/results
python3 run.py --cli /path/to/candidate/archify/bin/archify.mjs --name candidate --product-sha d9ab19812a5ccf119a0d7e95e8d89accaa5fb025 --slf4j-base /path/to/slf4j-base --slf4j-head /path/to/slf4j-head --guava /path/to/guava-head --output /path/to/results
```

`--node` and `--java` select executables when they are not on PATH; `javac` must be alongside `java`. `--oracle` and `--oracle-sha` may select another explicitly pinned oracle. Output directories must not already exist. The harness checks the product commit and clean status before and after, source commits and selected file hashes, and Java-file cleanliness. It saves command logs, raw facts, question results, declaration receipts, and `report.json`; these raw outputs can contain source and local paths. For archive mode, the harness verifies the archive digest and checks every file in the extracted `archify` tree against the ZIP before and after the run; extra files are rejected except under `node_modules`. The supplied CLI must be `archify/bin/archify.mjs`. `--product-sha` is a provenance label in archive mode, not a commit assertion: verify the archive-to-source relationship separately. The digest does not verify the installed dependencies.

The packaged `baseline-results.json` and `candidate-results.json` are pathless per-method summaries of the original source captures, not a new replay. Across the three captures, baseline inventory omitted all 86 calls and question coverage was unavailable. Candidate inventory found all 86 with no extras; it correctly bound and navigated 26 known targets, and explicitly left 60 oracle-unknown sites unresolved. Candidate capture coverage was 259/260/615 files in SLF4J base/head and Guava respectively, with one parse-error file in each SLF4J capture and none in Guava. These counts apply only to the pinned captures and selected methods.

`coverage.json` compares captured Java files with the independently enumerated Git-tracked Java files in each analysis root: none were missing or unexpectedly captured. Rule evaluation separately excluded 106 and 107 SLF4J test-role files in the base and head captures; those exclusions are not missing call facts. The Guava scope is `guava/src`, not its entire repository.

## Archive replay

The candidate archive was built from `d9ab19812a5ccf119a0d7e95e8d89accaa5fb025` and has SHA-256 `0fe2c01d79544252a58011c2ab9b2363790442b52dc170ee16065c1aa77de49d`. In the source comparison all 152 packaged Code Analysis module files matched the commit byte-for-byte; of all 387 files, the only byte difference was `archify/package.json`, whose standard staging transform removes `scripts` and `devDependencies` and reformats the JSON. The transformed manifest matched semantically. This comparison is separate from the harness's archive/extraction check.

Extract the ZIP into a fresh directory and install the module dependencies with the pinned Node version, then run:

```sh
unzip /path/to/archify.zip -d /path/to/extraction
cd /path/to/extraction/archify/modules/code-analysis
npm ci
cd /path/to/benchmark
python3 run.py --cli /path/to/extraction/archify/bin/archify.mjs --name archive --product-sha d9ab19812a5ccf119a0d7e95e8d89accaa5fb025 --archive /path/to/archify.zip --archive-sha 0fe2c01d79544252a58011c2ab9b2363790442b52dc170ee16065c1aa77de49d --slf4j-base /path/to/slf4j-base --slf4j-head /path/to/slf4j-head --guava /path/to/guava-head --output /path/to/results
```

A replay using the candidate source and this extracted archive produced byte-identical reports and all three raw facts files. All eight question results matched after normalizing only their `calls.provenance.rawFactsPath` and `workflow` paths; every other field was retained. Both runs found all 86 selected calls with no extras, bound and navigated the 26 known targets, and marked the remaining 60 explicitly unresolved. This confirms parity for this sample, not general archive behavior or Java accuracy.

See [upstream research](RESEARCH.md) for the compiler/indexer comparison. `archive-results.json` records the package/source comparison at source commit `d9ab19812a5ccf119a0d7e95e8d89accaa5fb025`; benchmark-only edits do not change the packaged product. The 26 known targets represent 26/86 of selected invocation sites, not 100% Java target coverage.
