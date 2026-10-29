# A cancelled task and a running thread have different lifetimes

[Preferred two-column page](two-columns.html) · [State comparison with automatic layout](candidate.html) · [Independent author draft](author/answer.html)

This case checks a boundary of the earlier TaskGroup explanation: an async wrapper can finish cancellation while thread work it started continues. It specifically concerns an **already-running** function passed through `asyncio.to_thread`. It does not claim that all submitted work starts or that cancellation is ineffective for queued work.

## Sources and observation

Source behavior is pinned to CPython 3.13.9, commit `8183fa5e3f78ca6ab862de7fb8b14f3d929421e0`:

- [`to_thread`](https://github.com/python/cpython/blob/8183fa5e3f78ca6ab862de7fb8b14f3d929421e0/Lib/asyncio/threads.py#L12-L25) awaits `run_in_executor`; [the executor submission](https://github.com/python/cpython/blob/8183fa5e3f78ca6ab862de7fb8b14f3d929421e0/Lib/asyncio/base_events.py#L887-L901) is wrapped as an asyncio Future.
- [Cancellation forwarding](https://github.com/python/cpython/blob/8183fa5e3f78ca6ab862de7fb8b14f3d929421e0/Lib/asyncio/futures.py#L362-L423) attempts cancellation of the underlying Future. A [running executor Future cannot be cancelled this way](https://github.com/python/cpython/blob/8183fa5e3f78ca6ab862de7fb8b14f3d929421e0/Lib/concurrent/futures/_base.py#L364-L382).
- A [work item checks for successful cancellation before executing its function](https://github.com/python/cpython/blob/8183fa5e3f78ca6ab862de7fb8b14f3d929421e0/Lib/concurrent/futures/thread.py#L47-L65). The pending/running distinction therefore stays in the explanation.

[probe.py](probe.py) runs locally on **Python 3.15.0**, separately from the pinned source version. An Event guarantees the worker has started; another gate holds its work until the caller explicitly releases it. There are no external requests, sleeps used to infer scheduling, or performance measurements. Timeouts only bound fixture failure, and cleanup releases the gate and collects async tasks.

| Path | Before releasing the worker | After release |
| --- | --- | --- |
| Direct cancellation | Caller received CancelledError; wrapper done/cancelled; thread work unfinished | Thread work completes |
| TaskGroup child failure | Caller caught ExceptionGroup outside the group; wrapper done/cancelled; thread work unfinished | Thread work completes |

The direct `Task.cancel()` request returned `True`; that observed return did not mean the running thread had stopped. The [first run](probe-first-output.json) and [second run](probe-output.json) are identical. Both executions returned after cleanup. No queued-work experiment, CPython 3.13.9 execution, universal cancellation guarantee or timing result is claimed.

## Authoring and visual choices

One independent gpt-6.1-terra/medium author used frozen runtime `422328ebf897679f7e1eca69251da0905b146471` and the retained [prompt](author-prompt.txt). This was discovery, not an instruction A/B comparison. Its first strict finalize failed a Chinese wording rule about three “的” characters in a sentence; [the actual failure](author/finalize-1.json), first draft and subsequent passing attempt are preserved. No complete authoring-time measurement is claimed.

The parent made two changes:

1. Show the two object states as facts, and explicitly connect the observed `True` return to the still-running thread. The phone observation panel grows from about 459 to 631 px; the extra space makes that distinction visible.
2. Use the existing authored `span=6` hints for the three panels. No runtime rule changed. On desktop, the automatic three-column variant made the observation panel 589 px tall and stretched its neighbors. The preferred two-column variant gives the conclusion and steps more width. It still leaves space in the shorter stopping panel and slightly increases total page length; this is a content-specific layout choice, not a new default.

Removing only the span hints makes the two-column Markdown identical to the state-comparison variant ([comparison](comparison.json)). At 390 px the two variants have identical panel dimensions. The preferred variant fits the page at 390, 1024 and 1440 px with no measured panel-content clipping ([phone/desktop](two-columns-metrics.json), [middle width](medium-width-check.json)).

Parent inspection covered [original desktop](author-1440.png), [automatic layout with facts](candidate-1440.png), [preferred desktop](two-columns-1440.png), [phone facts](candidate-group-390.png) and [dark phone facts](two-columns-group-dark-390.png). These are agent visual observations, not human readability acceptance.

## Verification boundary

Both parent variants passed strict finalize with zero diagnostics. The parent state-comparison artifact also passes its [current-path check](check.json). Copying the original author's output preserves its original absolute delivery paths, so its [relocated provenance check fails](author/relocation-check.json); that failure is retained rather than rewriting receipts.

This round changes no product runtime, package source, Skill instructions or live installation. No ZIP rebuild, full browser gate, full regression suite, Windows check or final-head CI is claimed. Source semantics, local execution, content repairs and visual preferences remain separate kinds of evidence. The index loaded both new variants with matching full-page links and a 390 px outer page ([interaction](index-check.json)); all 32 current local targets exist ([links](index-links.json)). Earlier variant checks keep their original revision and scope.

Disposition: retain the two-column explanation and the alternative layouts in the experimental branch. The repeated Chinese wording-rule repair is a concrete next investigation: determine whether counting “的” detects unclear prose or merely creates avoidable edits before changing any validator.
