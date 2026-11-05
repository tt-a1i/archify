# Standalone Explainer Reader Baseline

This record answers the baseline request on [#1068](https://github.com/tt-a1i/archify/issues/1068): distinguish recorded `dev` reader behavior from the Version control introduced by #1066 before proposing an implementation slice. It is evidence only. It does not approve, implement, or close any phase of #1068.

The measurements and the three screenshots below are the maintainer-slimmed form of [#1069](https://github.com/tt-a1i/archify/pull/1069) (head `1bc160740efde6f74ec8518c207db049f682325f`), captured by [@outlier27-cell](https://github.com/outlier27-cell). They were not recaptured for this copy. [#1069](https://github.com/tt-a1i/archify/pull/1069) can close once this record is on `dev`.

## Question

What did this recorded Chinese Explainer input do at `390x844` on the two exact revisions below? This record does not decide whether narrow-screen overflow exists in every locale, style, or current-`dev` scenario.

## Exact inputs and revisions

The same checked-in input was used at both revisions:

```text
archify/examples/delivery.explainer.json
```

| Label | Revision | Version control present |
| --- | --- | --- |
| Recorded dev | `b71d1b3e38f71d0f7fe91207b750cc307357c91a` | No |
| #1066 head | `bd5244388fedd4e74462fb04c588bbbea5c18956` | Yes |

Checked against `origin/dev` `283734e91458323fe38af3d1a79e770b3be5d6bf`, `bd524438` is not an ancestor of that `dev`. The comparison is between two independently rendered revisions, not an assumption that #1066 has already integrated.

## Method

The tracked [capture harness](capture-baseline.mjs) renders both revisions and opens them in the repository's `ChromeVisualBrowser` adapter. It applies identical desktop and narrow viewport metrics, then records layout boxes, control visibility, document overflow, and a PNG screenshot. For the #1066 head only, it substitutes a deterministic response to the existing explicit update-check action so the post-check control label can be measured. This response is installed before navigation; it does not create an initial-load request and it is not part of either rendered page.

A fresh run writes local files that this record does not keep:

- `artifacts/dev-b71d1b3.delivery-explainer.html` and `artifacts/bd524438.delivery-explainer.html`
- `observations.json` (full geometry for every viewport and state)
- desktop screenshots at `1440x900`

Those paths are gitignored. The checked-in numbers are the table below and [measurements.json](measurements.json). The checked-in screenshots are only the three `390x844` captures that show the narrow overflow and the recorded-`dev` contrast.

Commands used from the checkout that contains this harness:

```powershell
git fetch origin dev --prune
$devRoot = '<checkout at b71d1b3e38f71d0f7fe91207b750cc307357c91a>'
$referenceRoot = '<checkout at bd5244388fedd4e74462fb04c588bbbea5c18956>'
git -C $devRoot rev-parse HEAD
git -C $referenceRoot rev-parse HEAD
$env:ARCHIFY_DEV_ROOT = $devRoot
$env:ARCHIFY_REFERENCE_ROOT = $referenceRoot
node docs/research/2026-10-23-artifact-reader-baseline/capture-baseline.mjs
```

```bash
git fetch origin dev --prune
dev_root='<checkout at b71d1b3e38f71d0f7fe91207b750cc307357c91a>'
reference_root='<checkout at bd5244388fedd4e74462fb04c588bbbea5c18956>'
git -C "$dev_root" rev-parse HEAD
git -C "$reference_root" rev-parse HEAD
ARCHIFY_DEV_ROOT="$dev_root" ARCHIFY_REFERENCE_ROOT="$reference_root" \
  node docs/research/2026-10-23-artifact-reader-baseline/capture-baseline.mjs
```

The harness rejects either root unless its checked-out `HEAD` exactly equals the SHA in the table above. It deliberately does not render the evidence checkout as `dev`. Re-running it refreshes the gitignored local outputs. It does not rewrite `measurements.json`; update that file from the new `observations.json` only when a new capture replaces this record.

Viewports:

- Desktop: `1440x900`
- Narrow: `390x844`

States:

- both revisions: initial open;
- `bd524438` only: explicit update check yielding a newer stable version.

## Measured results

`lastControl` in [measurements.json](measurements.json) is the captured Chinese label (`导出`, `版本 3.2.1`, `新版本 3.2.2`). The table uses the same reading as [#1069](https://github.com/tt-a1i/archify/pull/1069).

| Revision | Viewport | State | `scrollWidth / innerWidth` | Overflow | Last top-level control | Fully visible |
| --- | --- | --- | --- | --- | --- | --- |
| dev `b71d1b3` | `1440x900` | initial | `1440 / 1440` | No | Export, right edge `1360` | Yes |
| dev `b71d1b3` | `390x844` | initial | `390 / 390` | No | Export, right edge `352` | Yes |
| #1066 `bd524438` | `1440x900` | initial | `1440 / 1440` | No | Version 3.2.1, right edge `1360` | Yes |
| #1066 `bd524438` | `1440x900` | update available | `1440 / 1440` | No | New version 3.2.2, right edge `1360` | Yes |
| #1066 `bd524438` | `390x844` | initial | `438 / 390` | **Yes** | Version 3.2.1, right edge `438` | **No** |
| #1066 `bd524438` | `390x844` | update available | `451 / 390` | **Yes** | New version 3.2.2, right edge `451` | **No** |

## Screenshots reviewed

| State | Screenshot |
| --- | --- |
| dev narrow initial: contained, no Version control | [dev-b71d1b3-390x844-initial.png](screenshots/dev-b71d1b3-390x844-initial.png) |
| #1066 narrow initial: Version control clipped | [bd524438-390x844-initial.png](screenshots/bd524438-390x844-initial.png) |
| #1066 narrow update available: wider clipped control | [bd524438-390x844-update-available.png](screenshots/bd524438-390x844-update-available.png) |

The three `1440x900` screenshots from #1069 showed no overflow. Their numbers stay in the table; the image files are not checked in.

## Recorded result and scope

For this historical Chinese/`390x844` comparison, recorded `dev` was contained while the recorded #1066 revision overflowed:

- recorded dev ends with the Export control at 352px and remains contained at 390px;
- the #1066 head appends Version at 438px initially and New version at 451px after an explicit check.

This result preserves the exact revision and fixture evidence above. It does **not** establish that P0 must depend on #1066, or that current `dev` cannot have an independent narrow-screen fix.

Later, [BlueboxC's contributor-run exact-upstream matrix on #1068](https://github.com/tt-a1i/archify/issues/1068#issuecomment-6371368371) covers English and Chinese, four styles, and `320`/`390`/`1440` viewports on exact upstream `dev` and the current #1066 head. BlueboxC's [single-`reader.css` before/after follow-up](https://github.com/tt-a1i/archify/issues/1068#issuecomment-6371823416) reports the same matrix before and after their candidate, while keeping stable-version fixtures distinct from untouched artifacts. Those records support the current P0 scope; this record neither reruns them nor adopts their candidate.

This remains a narrow evidence record, not a P0 implementation or approval to change the rendering path. P1 (identity presentation) and P2 (possible lighter disclosure) remain deferred.

## Limits

- This is one representative Chinese Explainer input, not a claim about every authored title, locale, style or diagram size.
- The explicit update result uses a deterministic local browser response solely to exercise the existing UI after reader action; it is not a network test, publication test or replacement for #1066's own offline/update coverage.
- These screenshots demonstrate geometry and visible control containment. They do not establish screen-reader behavior, contrast ratios, OS-level print output, or broad accessibility conformance.
- No runtime or UI code was changed for this record.
