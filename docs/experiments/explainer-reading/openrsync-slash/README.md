# Which directory level does a source slash copy?

Round 31, 2026-10-30. Disposition: source-backed reading candidate. [Open the page](candidate.html), [authored source](candidate.archify.md), [independent author's original](author/answer.html).

For the tested local recursive copy into an empty `dst`, `src` produces `dst/src/`, while `src/` puts its contents directly under `dst/`. Both copy nested files. The candidate puts each command next to its resulting tree, retains the `dst` root, and compares the complete nested-file paths. These trees are formatted filesystem observations, not rsync stdout.

Runtime/source: `18e6350f1fc2bc0f72655bf59258b460ad5b3e20`; refreshed `dev` remains ancestor `5ecbd1bfdbf83ea747072112493c940e707569cb`. No runtime, authoring instruction, dependency or ZIP changes.

## Source and executable evidence

The local `/usr/bin/rsync` identifies as Apple openrsync, protocol 29, with an rsync 2.6.9 compatibility banner. `what` reports project `rsync-184`. The matching Apple source tag resolves to `13eacd7e9a204b236310dab23682f6354ecc69bd`; the [manual explains recursion and the source slash](https://github.com/apple-oss-distributions/rsync/blob/13eacd7e9a204b236310dab23682f6354ecc69bd/openrsync/openrsync.1#L760-L773) and [creating a missing destination](https://github.com/apple-oss-distributions/rsync/blob/13eacd7e9a204b236310dab23682f6354ecc69bd/openrsync/openrsync.1#L972-L981). Matching project identity is not a reproducible binary-build verification. [Identity and hashes](source/identity.json), [source audit](source/audit.md).

[Probe](source/probe.py), [run 1](source/probe-1.json), [run 2](source/probe-2.json): four independent temporary-directory constructions, with/without the source slash and existing-empty/absent destination. The two JSON results are byte-identical. All preserve the regular, nested and hidden file contents and leave the source unchanged. No symlinks, filters, remote host, archive metadata, deletion or performance comparison is exercised.

The parent's [initial probe](source/initial-probe.py) incorrectly expected an absent destination to omit the source directory even without a slash. Two initial runs failed that assertion; their stdout was empty and the diagnostic appeared in tool output. An additional exact replay is preserved in [failure record](source/initial-reproduction.json), [stdout](source/initial-reproduction.stdout) and [stderr](source/initial-reproduction.stderr). Correcting the expected result is a probe correction, not an openrsync fix. Initial upstream rsync research is recorded separately and is not used to identify the local implementation.

## Author and reading revisions

The [bounded plan](evidence/plan.md), [author assignment](evidence/author-prompt.txt), [first draft](author/first-draft.archify.md), and [trace](author/author-trace.json) remain. The independent Terra/medium author first referenced a probe outside its allowed source root; that attempt failed. It copied the unchanged probe inside its own folder and passed the second strict finalize. The first shell wrapper used zsh's reserved `status` variable, so its exit status was not captured; the retained receipt reports failure. Work started 21:37:53Z and handoff was 21:38:26Z. Prompt-read completion is unknown, and parent work is additional.

The original stacks both outcomes in one panel and puts a full commit hash/build qualification into the final prose. Parent revisions separate the paired commands/results, express the recursive boundary through actual nested paths, and keep the full version audit in the experiment record.

| Retained version | Phone height | Desktop height | Observation |
| --- | ---: | ---: | --- |
| [Original](author/answer.html) | 2,338 px | 1,049 px | Both results stacked in one column |
| [Revision 1](attempts/candidate-1.html) | 2,261 px | 1,281 px | Separate outcomes; input tree makes the columns uneven |
| [Revision 2](attempts/candidate-2.html) | 2,192 px | 1,213 px | Short input paths preserve the fixture and bring outcome panels closer together |

The final desktop page is 164 px taller than the original; the selected tradeoff is easier side-by-side comparison, not minimum page height. [Original measurements](evidence/author-browser.json), [revision 1](attempts/candidate-1-browser.json), [revision 2](attempts/candidate-2-browser.json). Checked 390/1440 px light/dark states have no horizontal document/snippet overflow. Parent pixel inspection covered [desktop comparison](screenshots/candidate-2-1440-light-top.png), [phone continuation](screenshots/candidate-2-390-dark-bottom.png) and exported pixels below. Two content revisions were used; no further layout revision was made.

## Delivery checks and limits

The canonical page passes [strict finalize](evidence/candidate-finalize.json) and [current-path provenance check](evidence/candidate-check.json); artifact SHA-256 `85e958931d6849e3fac9fa895c69c82309d25adab977121c8637e10917a8f2bd`.

A parent CLI invocation first used unsupported `--strict`; its [failure receipt](evidence/invalid-cli-option.json) is retained. A following malformed `check explainer ...` invocation printed usage and no JSON. Both were invocation errors; the corrected commands use `--writing strict` and `check <artifact>`.

Five actual Copy controls match their visible code. [Captured payloads](evidence/copies.json) were intercepted at Clipboard API writeText, without validating OS clipboard permissions. The [copied-command runner](evidence/copy-run.py) executes allowlisted argv in four fresh fixtures; its [results](evidence/copy-run.json) match all visible path trees and file contents and preserve source files.

The [actual reader PNG](candidate-390-light.png), 780 × 4482 px, was inspected as pixels at [top](screenshots/export-top.png), [middle](screenshots/export-middle.png) and [bottom](screenshots/export-bottom.png). The [export/index check](evidence/export-index-check.json) switches both variants at both preview widths and checks their full-artifact links. The index now contains fifteen questions across thirteen projects and thirty-four variants.

Runtime suites and ZIP builds are unchanged and were not repeated for this content-only addition. Round 30's runtime/package evidence remains at source `3e356695afca522e8bcc72a0899869d7325a4e12`. Historical artifacts/receipts preserve their original paths; only the canonical finalize/check certifies the current repository path. No full browser acceptance runner, Windows, final-head CI, general generation comparison or human comprehension result is claimed. Four evidence files trim extra trailing blank lines; [original/archive hashes](evidence/archive-normalization.json) record this formatting change. Archive file hashes are in [manifest](manifest.json).

Under the [project benchmark convention](../../../../benchmarks/real-repo-generation/README.md), this is one new-project discovery with parent reading revisions. AI disclosure: Codex researched, authored, edited, executed probes and inspected browser/export pixels; no human acceptance is implied. Nothing was merged, released or installed. The ongoing goal remains active.
