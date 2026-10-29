"""Observe cancellation after to_thread work has definitely started.

No external I/O. Event gates establish ordering; timeouts only bound failure.
This probes the installed interpreter, not necessarily the documented release.
"""

import asyncio
import json
import sys
import threading


async def observe(mode):
    loop = asyncio.get_running_loop()
    started = asyncio.Event()
    finished = asyncio.Event()
    release = threading.Event()
    completed = threading.Event()
    events = []
    worker_errors = []
    tasks = []

    def record(message):
        # All event-list writes run on the loop thread.
        events.append(message)

    def worker():
        loop.call_soon_threadsafe(record, "thread: started")
        loop.call_soon_threadsafe(started.set)
        try:
            if not release.wait(5):
                raise TimeoutError("parent did not release worker gate")
            loop.call_soon_threadsafe(record, "thread: completed work")
            completed.set()
            return "work result"
        except BaseException as error:
            worker_errors.append(repr(error))
            raise
        finally:
            loop.call_soon_threadsafe(finished.set)

    async def fail_after_start():
        await started.wait()
        record("child: raises ValueError")
        raise ValueError("fixture failure")

    try:
        if mode == "direct-cancel":
            task = asyncio.create_task(asyncio.to_thread(worker))
            tasks.append(task)
            await asyncio.wait_for(started.wait(), 2)
            record("caller: requests task cancellation")
            accepted = task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                record("caller: receives CancelledError")
            else:
                raise AssertionError("wrapper was expected to be cancelled")
        elif mode == "taskgroup-failure":
            accepted = None
            try:
                async with asyncio.TaskGroup() as group:
                    task = group.create_task(asyncio.to_thread(worker))
                    tasks.extend([task, group.create_task(fail_after_start())])
            except* ValueError as errors:
                assert len(errors.exceptions) == 1
                record("caller: catches ExceptionGroup outside group")
        else:
            raise ValueError(mode)

        before_release = {
            "async_wrapper_done": task.done(),
            "async_wrapper_cancelled": task.cancelled(),
            "thread_completed_work": completed.is_set(),
        }
        assert before_release == {
            "async_wrapper_done": True,
            "async_wrapper_cancelled": True,
            "thread_completed_work": False,
        }, before_release
        record("caller: releases thread gate")
        release.set()
        await asyncio.wait_for(finished.wait(), 2)
        assert completed.is_set()
        assert not worker_errors, worker_errors
        record("caller: observes thread completion")
        return {
            "mode": mode,
            "task_cancel_request_accepted": accepted,
            "before_releasing_worker": before_release,
            "after_releasing_worker": {"thread_completed_work": completed.is_set()},
            "events": events,
        }
    finally:
        release.set()
        for task in tasks:
            if not task.done():
                task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        if started.is_set() and not finished.is_set():
            await asyncio.wait_for(finished.wait(), 6)


async def main():
    return [await observe(mode) for mode in ("direct-cancel", "taskgroup-failure")]


if __name__ == "__main__":
    cases = asyncio.run(main())
    print(json.dumps({
        "python": sys.version,
        "scope": "Already-running thread work held behind an Event. No queued-work or timing claims. asyncio.run returned after executor shutdown.",
        "cases": cases,
    }, indent=2))
