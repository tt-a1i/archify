# 为什么取消 asyncio.to_thread 的外层任务后，线程还在继续？ {#thread-cancel}

当线程函数已经开始运行时，取消外层 Task 可以结束异步等待，却不会强制中断这个函数。Task 结束与线程函数结束是两个时刻。[](source:base) [](source:task-cancel)

- `to_thread` 把函数交给线程执行器，异步侧等待结果。[](source:threads)
- 取消会尝试传到执行器的 Future；已运行的工作不能这样取消。[](source:futures) [](source:base)
- 尚未开始的工作可能取消成功；结果取决于取消与启动的先后。[](source:workitem)

@answer scope="CPython 3.13.9 源码 · 已运行的线程函数"
@meta locale=zh-CN
@source threads title="CPython 3.13.9: asyncio.to_thread" url=https://github.com/python/cpython/blob/8183fa5e3f78ca6ab862de7fb8b14f3d929421e0/Lib/asyncio/threads.py
@source futures title="CPython 3.13.9: Future 取消传递" url=https://github.com/python/cpython/blob/8183fa5e3f78ca6ab862de7fb8b14f3d929421e0/Lib/asyncio/futures.py
@source base title="CPython 3.13.9: Future.cancel" url=https://github.com/python/cpython/blob/8183fa5e3f78ca6ab862de7fb8b14f3d929421e0/Lib/concurrent/futures/_base.py
@source workitem title="CPython 3.13.9: 线程工作项" url=https://github.com/python/cpython/blob/8183fa5e3f78ca6ab862de7fb8b14f3d929421e0/Lib/concurrent/futures/thread.py
@source task-cancel title="CPython 3.13.9: Task.cancel 和 TaskGroup" url=https://github.com/python/cpython/blob/8183fa5e3f78ca6ab862de7fb8b14f3d929421e0/Doc/library/asyncio-task.rst
@source probe title="本地观察：Python 3.15.0 两种取消路径" url=https://github.com/tt-a1i/archify/blob/eb61a8954710eccd523b5a8d95057c2fb38b7e18/docs/experiments/explainer-reading/thread-cancel/probe-output.json

## 取消请求走到哪里？ {#mechanism}

@steps
| submit | 提交函数 | `to_thread` 调用 `run_in_executor`，并等待其结果。 |
| cancel | 请求取消 | `Task.cancel()` 请求在协程中抛出 `CancelledError`；协程可以清理或抑制它。[](source:task-cancel) |
| propagate | 传到 Future | 异步 Future 取消时，会尝试取消执行器的 Future。[](source:futures) |
| running | 已在运行 | 执行器 Future 已是运行状态时，取消返回失败，函数继续执行。[](source:base) |

工作尚未开始时，如果执行器 Future 先成功取消，工作项检查后不会调用函数。取消仍然有用，但不能保证抢在启动前。[](source:workitem) [](source:base)

## TaskGroup 等到了什么？ {#group}

一个子任务抛出非 `CancelledError` 异常时，TaskGroup 会取消其余 Task，并等待这些 Task 结束。这个等待边界是 Task；它本身不代表已运行的线程函数已经结束。[](source:task-cancel)

在本地 Python 3.15.0 的观察中，线程先启动并等待信号。另一个子任务失败后，外层捕获 `ExceptionGroup`；此时包装 Task 已取消，线程函数尚未完成。随后释放信号，函数才完成。直接取消的观察也呈现同样的先后关系。[](source:probe)

@callout level=note title="证据范围"
| 机制依据固定版本 CPython 3.13.9 源码。观察运行于本地 Python 3.15.0，并非 3.13.9 实测。该观察没有测试排队工作或测量耗时。 |

## 如何让工作提前停下？ {#stopping}

如果函数由你控制，可传入线程安全的停止信号，并让函数在合适的检查点主动检查它。取消异步 Task 时设置该信号，再按需要等待线程函数确认退出。

@callout level=warning title="信号需要配合"
| 标志不会强制打断任意阻塞调用。函数必须有机会检查信号；对长时间阻塞的操作，还需考虑该操作支持的超时或退出方式。 |
