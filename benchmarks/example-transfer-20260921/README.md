# Worked-example transfer experiment

This studies the user's hypothesis that a clearly linked, normative example can
help an Agent author the right diagram with fewer repairs. Quality remains a
hard gate. It does not change the production package, renderer or validators.

The unchanged Skill already directs library/API authors to a small CLI example.
`existing-example-audit.md` documents its useful ownership/evidence shape and its
missing demonstration of conditional callbacks/error paths. The candidate adds
one worked small-library example, its exact synthetic source, a validated desktop
preview, a short explanation and an explicit entry-point link. All original
instructions/examples remain available. The combined condition does not isolate
the effect of the link, prose, JSON or preview individually.

`protocol.json` was written before prototype authoring. Known development scopes
p-retry and QuickLRU keep the exact prior task clauses and source revisions.
lilconfig is outside this bounded screen. Fresh Terra/medium authors run serially
in B/P then P/B order, each with a 600-second native limit and at most three
repairs after first finalize. Example reading, authoring, pre-finalize edits and
repairs count toward elapsed time. The observer watches for up to 900 seconds
from preparation to tolerate dispatch latency; the native author limit remains
600 seconds and expiration/missed writes remain reportable limitations.

The example's fixture is synthetic and contains none of the tested repositories'
facts. It teaches ownership, conditional callbacks, return/error paths, concise
labels with complete cards, and readable geometry. `example/source-traces.mjs`
checks observed callback order/state, including falsy authorization and a close
during authorization. `example/source.bundle` preserves the source Git identity.
For fixture reproduction:

```sh
git clone benchmarks/example-transfer-20260921/example/source.bundle /tmp/publisher-source
git -C /tmp/publisher-source remote set-url origin https://fixtures.invalid/archify/document-publisher
node benchmarks/example-transfer-20260921/example/source-traces.mjs
node benchmarks/example-transfer-20260921/example/build.mjs
node archify/bin/archify.mjs finalize architecture benchmarks/example-transfer-20260921/example/publisher.architecture.json /tmp/publisher.html --repo-root /tmp/publisher-source --quality showcase --json
```

Run these commands from the repository root, using fresh paths for reproduction.
The local-only identity still requires an origin remote; the first prototype
attempt exposed missing harness metadata, which was corrected without changing
source bytes or the candidate. Its failed receipt and same-candidate retry remain
preserved. Prototype V2 corrects strict-false wording to match JavaScript
truthiness; each version and its receipts are retained.

Harness commands:

```sh
python3 -B -m unittest discover -s benchmarks/example-transfer-20260921 -p '*_test.py'
python3 benchmarks/example-transfer-20260921/run.py freeze --scratch <scratch> --out <evidence>
python3 benchmarks/example-transfer-20260921/run.py begin --run p-retry-B1 --scratch <scratch> --out <evidence>
# Immediately dispatch a fresh Terra/medium author to the printed TASK.md.
python3 benchmarks/example-transfer-20260921/run.py finish --run p-retry-B1 --agent /root/<author> --scratch <scratch> --out <evidence>
python3 benchmarks/example-transfer-20260921/evaluate.py --scratch <scratch> --out <evidence> p-retry-B1
```

Prepare pinned task source clones under `<scratch>/repos/<task-id>` before freeze.
Repeat the frozen order without replacing failures. All package files are hashed:
B must match the base; P must match the exact base plus allowlisted example/link
changes. Source, task and author-instruction integrity are checked separately.
`freeze.json` records original/candidate package hashes and all experiment inputs.
Do not modify frozen inputs during author trials.

After all authors, `prepare_review.py` creates shuffled case folders with exact
source, original task clauses, candidate JSON and any eligible captures, without
condition/timing labels. Independent source and perceptual reviews are adjudicated
against original requirements; preserve original findings and any corrections.
`quality-adjudication.json` supplies first/final quality to `summarize.py`.
Missing reviews are unknown, never an inferred pass. `content_diff.py` records
content changes after removing declared geometry; it does not prove truth.

The summary records all observed content revisions separately from terminal
finalize revisions, and lexical access to the worked reference/example separately
from comprehension. No surfaced native errors does not establish absence of
HTTP/provider retries. Public traces exclude hidden reasoning/raw tool payloads.
Only same-quality completed pairs can support time savings; the screen and
reverse-order confirmation gate are fixed in the protocol.
