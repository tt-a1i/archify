# What happens when one TaskGroup task fails? {#taskgroup}

`TaskGroup` asks unfinished tasks to stop, waits for them to finish, then reports the errors. A child ending with `CancelledError` alone does not trigger this.[](source:taskgroup-doc)

- Tasks can run cleanup before they finish; cancellation is not an immediate stop.[](source:cancellation-doc)[](source:taskgroup-code)
- Default `gather` reports the first exception without cancelling the other awaitables.[](source:gather-doc)

@answer scope="Python 3.13.9 · asyncio · child task failure"
@meta locale=en style=clean
@source taskgroup-doc title="Python 3.13.9 TaskGroup documentation" url=https://github.com/python/cpython/blob/8183fa5e3f78ca6ab862de7fb8b14f3d929421e0/Doc/library/asyncio-task.rst#L353-L393
@source taskgroup-code title="CPython 3.13.9 TaskGroup implementation" url=https://github.com/python/cpython/blob/8183fa5e3f78ca6ab862de7fb8b14f3d929421e0/Lib/asyncio/taskgroups.py#L111-L176
@source abort-code title="CPython 3.13.9 cancellation and task completion" url=https://github.com/python/cpython/blob/8183fa5e3f78ca6ab862de7fb8b14f3d929421e0/Lib/asyncio/taskgroups.py#L221-L244
@source gather-doc title="Python 3.13.9 gather documentation" url=https://github.com/python/cpython/blob/8183fa5e3f78ca6ab862de7fb8b14f3d929421e0/Doc/library/asyncio-task.rst#L512-L539
@source cancellation-doc title="Python 3.13.9 task cancellation guidance" url=https://github.com/python/cpython/blob/8183fa5e3f78ca6ab862de7fb8b14f3d929421e0/Doc/library/asyncio-task.rst#L294-L316

## What happens after a task fails? {#shutdown}

@steps id=shutdown-steps
| fail | Failure | A child raises an exception other than `CancelledError`. |
| cancel | Cancel siblings | The group requests cancellation of unfinished siblings. |
| wait | Wait for tasks | The group waits for all children to finish, including their cleanup. |
| report | Report errors | The group raises the collected failures after the children finish. |

Cancellation is a request, not an immediate stop. A task can run `finally` cleanup before finishing; a task that does not finish can delay group exit.[](source:taskgroup-code)[](source:abort-code)[](source:cancellation-doc)

## What reaches the caller? {#errors}

For ordinary failures, the group raises an `ExceptionGroup` after all children finish. Multiple failures can be included; use `except*` to handle matching exceptions. If the `async with` body fails, its non-cancellation exception is included too.[](source:taskgroup-doc)

`KeyboardInterrupt` and `SystemExit` are special: the group still cancels and waits for siblings, then re-raises the original exception. Other base exceptions can produce a `BaseExceptionGroup`.[](source:taskgroup-doc)

## How does default gather differ? {#compare}

The comparison uses `gather` with its default `return_exceptions=False`.[](source:gather-doc)

| Question | `TaskGroup` | `gather` |
| --- | --- | --- |
| Ordinary failure | Requests sibling cancellation | Siblings continue {caution:Still running} |
| Error reaches caller | After all children finish | On first exception |
| Error form | Grouped failures | First exception |
| Child cancelled | Does not trigger sibling shutdown | Propagates cancellation; siblings continue |

If `gather` itself is cancelled, it cancels unfinished submitted awaitables.[](source:gather-doc)

## What should you check? {#checks}

- [ ] Put cleanup in `finally` blocks, and let cancellation propagate after cleanup.
- [ ] Handle expected grouped failures with `except*` outside the `async with` block.
- [ ] If sibling work must continue after a failure, choose and manage that behavior explicitly.
- [ ] If the group body is still active when a child fails, expect its current `await` to be interrupted.[](source:taskgroup-doc)[](source:cancellation-doc)
