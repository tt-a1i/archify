# Name the actions in the opening

[Revised explanation](candidate.html) · [Previous opening](base.html) · [Earlier case/source audit](../taskgroup/notes.md)

The previous title asks why TaskGroup cancels siblings, but the useful content explains what happens after failure. Its answer begins with “one unit of work” and “coordinated shutdown.” The revised title asks what happens, and the opening names the actions: ask unfinished tasks to stop, wait for them, then report the errors. The CancelledError exception sits immediately beside that sequence. Two supporting points explain cleanup and the difference from default gather.

This is a parent content repair on runtime `93fd116e85bae264fb0dec6a5946c176fad39083`, not an independent-author comparison, a new writing rule, or a human comprehension study. The existing toolbar proposal was not mixed into this comparison.

## Meaning and sources

The pinned [Python 3.13.9 documentation](https://github.com/python/cpython/blob/8183fa5e3f78ca6ab862de7fb8b14f3d929421e0/Doc/library/asyncio-task.rst#L353-L393) was reread. It supports cancellation of remaining tasks after a non-cancellation child failure, waiting before reporting errors, and the special treatment of KeyboardInterrupt/SystemExit. Cancellation and cleanup guidance supports the wording “asks … to stop,” with the immediate-stop misconception addressed beside it.

The source declarations, scope, step panel, error reporting, comparison table and checklist are byte-identical from `@answer scope` to the end ([identity](identity.json)). Their exception-group distinctions and active-body cancellation qualification remain intact. The original local Python 3.15 probe is reused only at its original scope; it does not verify the pinned 3.13.9 binary. No new probe result is claimed.

## Reading comparison

Both variants passed strict finalize with zero diagnostics on their first attempt. Parent inspection compared clean/light pages at the same 390 and 1440 CSS widths, plus a dark phone candidate. The [first candidate source](first-attempt.archify.md) is retained unchanged.

| Observation | Previous | Revised |
| --- | --- | --- |
| 390 px answer-card height | 512.5 px | 454.9 px |
| 390 px summary height | 172.5 px | 172.5 px |
| 1440 px answer-card height | 329 px | 323 px |
| 1440 px summary height | 80.1 px | 108.1 px |

The phone shows more of the following steps; the desktop summary takes an extra line, while the whole card is slightly shorter. This is a layout observation, not a measured comprehension improvement. Screenshots: [phone before](base-390.png), [phone after](candidate-390.png), [desktop after](candidate-1440.png), [dark phone](candidate-dark-390.png). [Raw measurements](visual-metrics.json) retain an unused empty table-selector result; table fit was not rechecked in this opening-only trial.

The English toolbar still makes the 390 px page 400 px wide in both arms. That unchanged problem has a separate [proposal replay](../mobile-tools/README.md). No whole-page mobile acceptance, full browser gate, regression suite, ZIP rebuild or human review is claimed here. Product source and authoring instructions are unchanged.

Disposition: retain the more concrete opening as a readable content variant, preserve the previous version and the desktop tradeoff, and continue exploration.
