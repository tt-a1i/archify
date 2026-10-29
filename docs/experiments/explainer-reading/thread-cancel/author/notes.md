# 作者记录

- 来源审计：使用提供的 CPython 3.13.9 固定提交源码摘录，覆盖 `to_thread`、Future 取消传播、运行状态取消、线程工作项与 TaskGroup/Task 取消。页面另引用本地 Python 3.15.0 观察结果；未把它写成 3.13.9 实测。
- 观察只涉及已启动且由 Event 挡住的线程函数，分别覆盖直接取消与 TaskGroup 子任务失败；未测试排队工作或计时，也未推断通用线程关闭保证。观察链接依赖父任务推送对应提交。
- 首稿保存于 `first-draft.archify.md`。第一次 strict finalize 因第 34 行连续三个“的”失败，输出保留于 `finalize-1.json`；只拆分该句后第二次通过，输出为 `finalize-2.json`。第二次工具报告用时 810 ms；未记录完整创作用时。
- 最终 validate、deliver、check 通过，无诊断；explainer finalize 未运行 browser-check，未进行截图或人工视觉验收。没有其他已知未解决事实问题。
