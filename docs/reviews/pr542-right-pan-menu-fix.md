# PR #542：右键平移与浏览器菜单冲突

## 复现与原因

用户在当前 Maka HTML 的透镜选中状态下右键拖动画布，浏览器菜单弹出。修复前提交为 `a2c692cf579f76d9242c66daf9b49b831beea40b`。

首先新增执行真实 Camera handler 的确定性测试，命令 `node --test --test-name-pattern="right pan owns" archify/test/viewer-canvas-input.test.mjs` 在 press-time context menu 断言失败。随后 Chrome 原生右键探针捕获 `pointerdown → contextmenu → pointermove → pointerup`；菜单事件的 defaultPrevented 为 false，当时画布已经处于 is-panning。最小场景不需要透镜或特殊节点。

比较三个假设：菜单在按下时触发、长按使保护窗口失效、目标元素未被接管。日志确认了第一项：旧逻辑只在移动后结束拖动时设置 250ms 菜单保护，无法覆盖按下时的菜单。

## 修复与边界

在现有 contextmenu handler 中同时检查已接管的右键拖动。复用 drag/button 状态，不新增计时器或模式。现有拖动结束保护仍覆盖 release-time 菜单。画布优先使用右键平移；不保证画布上的静止右击在所有浏览器中仍弹菜单，因为有的浏览器在移动前就请求菜单。未接管的工具栏、输入框、embed 与窄屏宽图滚动保持原行为。

新增确定性覆盖：按下前、首次移动前、长按、拖动结束、保护到期、取消/失焦和未接管目标。原生浏览器拖动矩阵增加右键，要求至少捕获一次真实 contextmenu 且全部被取消，同时验证位移、结束状态和没有尾随节点激活。

## 定向验收与消融

- 输入合同 25/25 通过。
- 完整真实 Chrome Camera 套件 34/34 通过，0 跳过。
- 修复后的 Maka 原图 JSON 不变；在 frontend/backend 透镜选择下重放真实右键拖动，contextmenu.defaultPrevented=true，pointermove 与 pointerup 正常。
- 隔离测试中仅删除 active right-drag 判断，原 press-time 测试再次失败；该必要条件恢复保留。没有新增可删抽象。

## 产物与最终验收

共享模板、两套五类示例、历史手写 web-app Viewer 块、Gallery、Checkout 比较及回执、README 动图/来源和 Node 22 ZIP 更新。Guide/Start 作者输入未变。Maka 交付及截图仍保留本地。

Maka 新交付产物为 705,423 B（比原产物增加 25 B），严格 provenance 检查与自动浏览器视觉检查通过；人工查看 1440×900 浅色和 2048×1320 深色截图，节点及底部内容完整。独立解压的 Node 22 安装包在无 node_modules 环境下 smoke 通过。当前修复没有更改作者 SVG、拓扑、字体、布局或导出逻辑。

完整门禁首次运行发现 Checkout 比较产物再生漏传 `--quality showcase`，已按原配置重新生成；整个 architecture-delta 套件重新运行 39/39 通过。完整 `ARCHIFY_CHROME=... npm test --prefix archify` 运行结束：2442 项中 2429 通过、12 条件跳过、1 失败；唯一失败就是上述比较产物，修正后对应完整套件 39/39 通过。该全量运行包含浏览器测试，不能把其计数与独立 Camera 34/34 相加。生成新鲜度、品牌/验证器/版本身份、golden 检查与 `git diff --check` 通过；没有将首次全量运行记为全绿。
