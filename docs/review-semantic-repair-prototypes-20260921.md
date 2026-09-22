# Review: semantic-repair experiment helpers (2026-09-21)

## Scope and disposition

Reviewed the frozen repository-only experiment helpers against base
`55beaa07e6eb46eb301bc40aade3747c25245660`. This review covers only the
navigation and diagnostic route-repair prototypes, their focused tests, and
the supplied task/rubric/protocol comparison contract. It does not grade an
author output or authorize product/default/remote use.

**Ready for this bounded experiment.** The one material scope escape found in
the initial navigation version was repaired and independently rechecked before
this disposition. The helpers remain appropriately narrow: navigation is a
static source-direction aid, and route repair is a conditional local geometry
repair that still requires full finalization.

## Navigation helper

`benchmarks/semantic-repair-20260921/navigation/semantic-navigation.cjs`
uses the supplied isolated TypeScript 5.9.3 dependency and creates a fresh
language-service program per invocation. It records AST declaration ranges,
distinguishes overload signatures from implementations, and reports a bounded
source slice with the exact full range/end line and explicit truncation count.
Alias canonicalization and reference lookup are exercised by the focused
barrel-re-export fixture. Ambiguous same-name lookup fails closed and asks for
a file-qualified selector; invalid locations also fail with exit 2.

The initial audit reproduced a scope escape: importing `out/outside.ts` from a
single eligible `src/in.ts` allowed `--symbol outside` to return an
out-of-scope declaration. That would have contradicted the prescribed source
scope and weakened the comparison. The current helper realpaths the scope,
builds an eligible-root file set, restricts `--symbol` and `--at` to it, filters
returned declarations/references, and exposes `omittedByScope` when a
within-scope use resolves outside the source root. Its new fixture also rejects
a symlinked scope that realpaths outside the repository. Independent rerun:

```
/opt/homebrew/opt/node@22/bin/node --test benchmarks/semantic-repair-20260921/navigation/semantic-navigation.test.cjs
# exit 0; 6/6 tests passed
```

A focused post-fix external-import reproduction returned exit 2 for both
`--symbol outside` and `--at out/outside.ts:1:14`, with the expected
in-scope-only errors. The current authors' two frozen seed commands were also
reported by the coordinator as successful (~0.346 s and ~0.350 s whole CLI).

Limits that must remain explicit in analysis: it uses fixed compiler options,
not target `tsconfig` loading; TypeScript can parse imported dependencies, but
the helper suppresses their locations; and dynamic imports, `eval`, reflection,
runtime registration/configuration, and unresolved external modules are not
evidence. A successful result directs source reading only. It cannot prove the
dynamic behavior required by the semantic rubric.

## Route-repair helper

`benchmarks/semantic-repair-20260921/route-repair/route-repair.mjs` only
accepts architecture documents with no authored route-control field (`via`,
`route`, endpoint sides, or channel coordinates). It returns `unchanged` for a valid input and declines
non-route diagnostics, ambiguous/multiple diagnosed edges, unsupported
geometry, unavailable layout points, and all unsuccessful fixed recipes. It
never moves components or alters topology/labels: the semantic projection
removes only `via`, and the internal guard rejects any other change.

It applies no more than three predeclared local trials (one measured detour
plus two corridor alternatives), binds each production validation to the
canonical bytes it wrote, and accepts only when the layout receipt is valid and
the full showcase validation is `ok`, has the same candidate SHA-256, has no
composition errors/warnings, and has at least nine passing checks. The CLI
does not treat this as delivery: its receipt sets `finalizeRequired: true`, and
the frozen R prompt requires a subsequent full `finalize` before output is
accepted.

Independent checks:

```
/opt/homebrew/opt/node@22/bin/node --test benchmarks/semantic-repair-20260921/route-repair/test-route-repair.mjs
# exit 0; 4/4 tests passed
```

The fixture input's raw on-disk SHA-256 is
`7779cdbbc81ad0c22b5ac12f986b962f44308264e7c313526da5f6d707589645`.
The repair CLI writes canonical JSON; I reproduced written
`repaired.json` SHA-256
`71a5295b890a66089e5e69d94a49627321ac10a586ca560c9e42c0bb25b1cdf8`,
which exactly matched the receipt's `candidateSha256`, with `status=repaired`,
one successful trial, the short-interior diagnostic, and
`finalizeRequired=true`.

This is evidence for the helper's local geometry eligibility and validation
binding only. It is not evidence that a resulting diagram meets its task's
source completeness, semantic entailment, or common-viewport readability;
the authors' ordinary source work and required full finalize remain the gates
for those outcomes.

## Comparison and protocol checks

`tasks.json`, `rubrics.json`, and `protocol.json` keep the six primary author
runs on pinned revisions, fixed order, 600-second author cap, three-repair
cap, and independently reviewed source/semantic/common-viewport conditions.
`prepare_prompts.py` gives only N runs the static helper, requires the seed
query first, states its static/truncation limits, and gives only R the route
helper after a supported first production failure. The R prompt preserves
written candidate/output separation, one helper invocation, repair adoption
only on `status=repaired`, and required full showcase finalize.

The route helper is deliberately not supplied to the navigation condition, and
the navigation helper is deliberately not supplied to route/manual conditions.
The experiment can support a limited hypothesis about authoring time and
quality under these frozen aids. It cannot support a general claim that either
prototype improves production authoring or runtime behavior.
