# Candidate comparison on Archify itself

The old entry is commit `2877c1576610fe171c562f37cc53c5d6bb77e91a`. The new entry
is this branch. Both ran on the same checkout with `--language ts`.

## Scan result

| Measure | Old | New |
| --- | ---: | ---: |
| Findings | 504 | 448 |
| Warning | 234 | 210 |
| Info | 270 | 238 |
| `complexity/function` | 501 | 445 |
| Files analyzed | 264 | 242 |
| Files excluded by role | 367 | 389 |
| Vendor findings | 56 in 12 files | 0 |
| Top priorities | `build`, `semanticErrors`, `createReadableLayout` | unchanged |
| Receipt has `ruleCounts` | no | yes |
| Receipt has `investigation.leads` | no | yes |

The 56 removed findings are the vendored-bundle false positives. The candidate
classifies `vendor/`, `vendored/`, `third_party/` and `third-party/` as
`generated` by default; users can override `roles.generated` in a config. The
analysis still captures those files in raw facts, but they no longer produce
first-party complexity findings.

The new receipt adds:

- `ruleCounts`: open findings by rule, so 445 complexity findings do not hide
  4 coupling signals.
- `investigation.leads`: the three priorities with `message`, `where`
  (`path:line`), `symbol`, `impact`, and a runnable `task` command.
- `investigation.drillDown`: the same command with an `<id>` placeholder.
- `formatText` prints the same leads under **Start here**.

## Clean-session comparison

Both sessions received only the repository path and “帮我看看这个项目”.
The first session ran on the old commit; the second on the candidate. Neither
was given findings, files, a language or a maintenance target.

| Measure | Old session | New session |
| --- | ---: | ---: |
| Tool uses | 58 | 49 |
| Subagent tokens | 2,344,087 | 2,201,119 |
| Duration | 150.6 s | 237.8 s |
| Files/artifacts read | ~18 | ~20 |
| `findings.json` read | 850 KB | 758 KB |
| First lead | vendor false positives | `compileDataflow.build` (top priority) |
| Other leads | `scripts` ↔ `website` cycle; `commandDeliver` | `semanticErrors`; `archify` internal-leak signal |
| Source verification | yes, all three | yes, all three + a 64-test dataflow run |
| False-defect readings | none; complexity and coverage treated as signals/scope | none; same, plus module-level `impact` critique |

The new session used `investigation.leads` for the first lead and `ruleCounts`
to notice that 445 of 448 findings are one rule. It rejected all three leads it
verified: `compileDataflow.build` is an orchestrating closure with ~40 named
helpers and passing tests; `semanticErrors` is one independent check per schema
rule; the `archify` internal-leak signal is expected for a private CLI package
with no library entry point.

The session did not get cheaper: 49 tool uses and 2.20 M tokens are close to the
old session, and wall-clock time increased because it ran a 58-second dataflow
test and verified more source. On this repository, the measurable product gains
are the 56 removed false positives and the self-contained first lead, not a
large context reduction.

## What the comparison does not show

- No maintainer reviewed either session, so no adoption is claimed.
- One session per entry cannot separate the entry change from agent variance.
  The requests old/new pair in [external/README.md](external/README.md) is a
  second data point; there both entries found the same first lead.
- The new entry still ranks by complexity because complexity supplies almost
  all findings. `ruleCounts` exposes coupling signals, but a session that reads
  only the three leads can miss them.
- `impact` is module-level: every lead in the `archify` module has `fanIn 9` and
  `files 141`, so only the complexity `size` differs between them.
- The candidate session was run on a copy without this benchmark directory, so
  it could not read these answers. The copy predates the final `ruleCounts`
  open-only fix and README corrections; neither changes the 448-finding result.
