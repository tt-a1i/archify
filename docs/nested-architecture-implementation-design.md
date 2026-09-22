# 嵌套架构图：独立子图与逐层导航实现草案

状态：主方案已选定，待实施。实施范围、固定契约与完成条件以 [执行 Goal](nested-architecture-goal.md) 为准；本文保留实现论证与连接点说明。字段、命令和接口尚未实现。

## 目标与首版范围

读者从总览节点进入内部结构，再进入下一层；返回恢复原阅读位置。每层使用独立布局和既有 architecture IR，最终交付一个离线 HTML。

首版支持 architecture 图、单父内部结构树、显式外部对象引用、图内已有探索及既有导出的有效能力分支。每个节点最多一个默认内部图。精确范围和延后能力见执行 Goal 的实施边界。

## 创作格式

新增图集清单，图文件继续使用已有 schema。源路径相对清单目录解析，浏览器不读取这些路径。

```json
{
  "atlas_version": 1,
  "entry": "system",
  "meta": {
    "title": "订单平台",
    "locale": "zh-CN",
    "visual_preset": "classic"
  },
  "diagrams": {
    "system": { "source": "system.architecture.json" },
    "payment": { "source": "payment.architecture.json" },
    "worker": { "source": "worker.architecture.json" },
    "orders": { "source": "orders.architecture.json" }
  },
  "details": [
    { "from": { "diagram": "system", "node": "payment" }, "to": "payment" },
    { "from": { "diagram": "payment", "node": "worker" }, "to": "worker" },
    { "from": { "diagram": "system", "node": "orders" }, "to": "orders" }
  ],
  "references": [
    {
      "occurrence": { "diagram": "payment", "node": "redis" },
      "target": { "diagram": "system", "node": "redis" }
    },
    {
      "occurrence": { "diagram": "orders", "node": "redis" },
      "target": { "diagram": "system", "node": "redis" }
    }
  ]
}
```

示例假定总览定义 payment、orders 和 redis；payment 图定义 worker 和 redis；orders 图定义 redis。各源文件还需提供既有 renderer 要求的语义与几何数据。

契约：

- `entry` 存在且没有内部结构父节点；所有其他图从 entry 经 details 可达。
- 每个 details.from 唯一，每个非根图恰好一个 details 父节点；拒绝自环、环、孤立图和未知节点。
- 内部图解释来源节点的结构范围，允许省略细节，不声明穷尽。外部依赖应作为上下文引用指向其规范定义；必要时可在总览定义第三方系统。
- references 两端存在，target 必须直接指向非引用节点；禁止引用链、循环和自引用。一个 occurrence 只有一个 target。
- 引用节点保持原 semantic kind。例如 Redis 仍为 database，另有上下文身份；引用双方类型须一致。
- 引用节点不再拥有自己的内部图。读者先跳到规范定义，再从定义节点进入内部图。
- 跨图地址使用 `(diagramId, localNodeId)`；不同图的同名节点合法。跨图移动规范定义需要显式更新引用，不提供跨版本实体身份推断。
- 图标题以各自 meta.title 为准。固定 UI locale/preset 从图集继承；子图显式冲突时诊断失败。运行时主题是图集级偏好。
- details 与 references 都不是通信边，绝不进入图内的可达性或路径计算。

这里不再增加 owner、subject、全局实体注册表。子图的解释对象由唯一入向 detail 推导。

## 构建与交付

拟新增命令：

```sh
node archify/bin/archify.mjs deliver atlas project.atlas.json project.html --quality showcase --json
```

atlas 是交付物类型，不是第六种图 renderer。既有单图命令保持原路径。新命令的选项、默认输出及不扩展的 CLI 分支以执行 Goal 为准。

构建过程：

1. 读取清单并验证格式、源文件路径和输出路径；输出不得覆盖清单或任一源文件。
2. 读取全部源文件的确定字节，冻结到目标旁的暂存目录。之后只使用冻结内容。
3. 使用既有 schema 验证每个 architecture IR，再验证 details 树和 references。
4. 推导每图上下文：入口、父层关系、节点引用标记。继承固定 UI 配置形成有效渲染输入，记录其摘要。
5. 每图经过既有 renderer、布局校验和产物检查。上下文静态标记及通用会话启动 gate/bridge 在最终检查前生成；atlas 成员的远程字体加载和 preconnect 等自主网络入口也在此之前移除，采用本地字体回退。
6. 把完整、经过检查的成员 HTML 序列化进外层 HTML。转义 JSON 中的 `<`、`>`、`&`，成员内容保持为未执行数据。
7. 独立整包检查器解析产物、验证成员数量和地址、重新核对每份内嵌成员字节及检查结果。
8. 所有检查成功后，同文件系统 rename 原子替换最终 HTML；任何失败保留旧产物。

逐图读取并冻结不等于活跃仓库的事务快照。产物准确对应读取到的字节；需要所有源码来自同一提交时，创作方应使用固定 checkout，并延续既有源码证据检查。

现有 single_svg 检查继续约束每份成员 HTML。外层图集使用新的整包检查，不能简单把 single_svg 放宽，也不能因成员被编码隐藏就跳过检查。

回执包含清单、原始源、有效渲染输入、每个成员产物和最终 HTML 的摘要与字节数，以及每图质量检查。跨图错误带图 ID 和清单路径，例如：

```json
{
  "code": "atlas/reference-target-missing",
  "subject": { "path": "/references/1/target", "diagram": "system", "node": "redis" }
}
```

回执输出到现有 JSON 结果；首版不增加需要和 HTML 联合提交的 sidecar 文件。

## 运行时方案

首版选择“完整成员 HTML 内嵌＋一个活动 srcdoc iframe”。外层持有图集数据和导航，子文档复用完整单图 Viewer。

这个选择接受模板重复带来的文件体积，换取已有单图产物的直接复用。共享模板与每图 payload、缓存多个 iframe、统一 mount/unmount 都不作为首版前置工作；先测实际包大小和切换成本。

iframe 用于 DOM、样式与生命周期隔离，不能把它当成无需验证的安全承诺。只装载本次编译产生的成员文档。离线消息校验使用实际窗口与会话代号；不能依赖 file/srcdoc 的字符串 origin 是唯一身份。输入转义和既有受限内容规则继续生效。

单独引入 atlas 会话模式。不能复用 embed=1，因为既有 embed 模式会隐藏导航、搜索、焦点和导出。

### 职责

| 所有者 | 内容 |
|---|---|
| 外层图集 | 图 ID 索引、结构路径、来源返回、唯一顶层 URL/history、每次访问快照、全局主题、整包分享 |
| 活动 Viewer | 当前图的焦点、章节、route/reach/lens、相机、源码入口、当前图导出 |
| 会话连接 | 初始化与恢复、局部地址变更、进入请求、偏好变更、导出忙碌状态、错误 |

只在外层提供层级导航；已有单图 toolbar 在内部继续工作，避免复制一套工具栏。

### 初始化与切换

现有运行时需要增加一个显式启动入口，覆盖模板头部的偏好初始化和主体模块启动。独立图直接启动；atlas 成员等待外层初始化配置后再运行现有模块，避免用 about:srcdoc 的地址或默认主题先初始化。通用 gate/bridge 已包含在构建时检查的成员字节中；运行时只原样设置 srcdoc，再通过 init 消息传入动态配置，不注入脚本或改写成员字符串。

会话接口草案：

```text
createSession({ html, initialAddress, appearance, restore, onEvent })
  -> { ready, snapshot(), setAppearance(value), dispose() }
```

外部导航调用者只使用 `navigate(address)` 和 `back()`。会话实现使用小型定类型消息，包含 protocolVersion、sessionId 和需要应答时的 requestId；不建立通用消息总线。

启动分为子文档桥已装载、收到 init、Viewer 初始化与布局稳定、完成恢复四个阶段。首次 bridge-ready 尚无会话代号，父层只接受来自当前新 iframe.contentWindow 且处于等待初始化阶段的消息；随后 init 分配 sessionId、entryId 与事务代号，后续消息必须匹配。iframe 的 load 事件不能代替最后两个阶段。

用户进入新图时：

1. 校验目的图/节点存在，创建导航事务代号。
2. 保存当前访问的地址、语义状态、相机和滚动；由外层合并更新当前 history.state。
3. 销毁旧会话，创建新 iframe。任何时刻最多一个活动 Viewer。
4. 发送目的地址、全局外观和可选恢复快照；新 Viewer 完成初始化与首轮稳定布局。
5. 先恢复局部语义状态，再恢复相机与滚动。恢复期间抑制自动取景、自动播放和地址回写。
6. 显示新 Viewer，将新访问作为一个顶层 history 条目提交；浏览器 popstate 恢复已有访问时不 push。

延迟结果必须同时匹配当前 iframe.contentWindow、sessionId 和事务代号。重复点击只允许最新事务完成。尚未提交的内部导航失败时，可以使用保存快照重新装载来源图；浏览器 Back/Forward 或冷启动失败时，地址已指向目标，应保留该条目显示明确错误，提供重试/返回入口，不能自动重装来源而造成地址和画面错配。

## 地址、历史与恢复

地址例子：`#diagram=worker&focus=executor`；图内已有 `view`、`route`、`relation`、`reach`、`lens` 的有效组合沿用既有语义。

新增统一地址入口，集中替换 Viewer 内直接读取 location/hash、写 history 和生成分享链接的位置。独立图通过该入口直接操作本窗口；atlas 成员通过它向外层报告局部状态。不能只追加 diagram 参数，因为现有多处代码会覆盖整段 hash。

- 跨图进入创建 history 条目；图内选择及平移不新增访问条目。
- 顶层是唯一 history 写入者；子文档不修改自己的 session history。
- 每次访问有独立 entryId，不能只按 diagramId 缓存快照。
- URL 保存可分享的语义地址；history.state 保存该次访问的恢复快照。相机和滚动在稳定变更后合并写入，避免浏览器 Back 时来不及异步获取。
- popstate 使用目标条目的快照，不依赖已经改变的 history.state 去保存来源记录。
- popstate 处理器在任何异步等待前同步废弃旧会话的状态写入资格。状态消息必须同时携带 entryId；只有该 entryId 与当前 history 条目一致、会话仍处于活动状态时，才允许合并 replaceState，避免旧图的迟到相机消息污染目标记录。
- 结构面包屑从 details 树推导；浏览“返回”来自实际访问记录。没有访问记录的冷启动提供“返回总览”。
- 不合法图或语义目标显式报错并提供恢复入口，不静默替换为另一张图。
- 分享链接带外层文件/页面地址；已分享 HTML 的接收者仍需要拿到该 HTML 文件或托管副本，复制 file URL 本身不会传输文件。

快照保存语义 ID/选中章节、已提交的 route/reach/lens 等阅读状态，以及逻辑相机位置、缩放和必要滚动。主题属于外层；悬停、弹层开合、动画帧、DOM 节点和 iframe 引用不进入快照。恢复后的故事和 trace 停止，读者显式继续。

窗口大小变化时，使用逻辑中心和缩放恢复，再裁剪到有效范围；不承诺不同窗口尺寸下像素位置完全相同。大图仍须通过可读性检查；独占画布不自动使任意规模的图合格。

## 父层上下文、共享对象与导出

父层上下文从宿主节点的真实入出边推导，不在清单重复维护。例如 Gateway→Payment 只出现在标明“父层关系”的区域；不会生成 Gateway→Controller。

父关系有作者 ID 时可以跳回 `(parentDiagram, relationId)`；没有 ID 时只显示，不用数组索引伪造稳定关系身份。

references 给当前节点增加“外部上下文”标记和可跳到规范位置的入口，但保留 database/backend 等既有类型。标记应由 renderer 产生在 canonical SVG 内，并纳入布局/导出检查；旧单图调用不传图集上下文。

图集上下文通过 renderer 内部参数传入，不给旧用户 IR 塞额外字段。实现时需把 architecture 渲染调用整理为可接收该参数的入口，保持普通 CLI 输出契约。

图内 route/reach 仅查询当前成员的作者通信关系。detail、reference、父层上下文都不生成可参与 BFS 的通信边属性。首版没有全局路径查询或折叠投影。

PNG/SVG 等导出当前层的完整规范图，保留静态上下文身份标记，去除相机和临时浮层。图集 UI 不混入标准图片；HTML 分享保留全部成员。

导出按钮继续由子 Viewer 直接响应用户操作。复制、下载、WebM、源码链接和 Presentation Stage 须在实际浏览器验证，不能假定 iframe 权限与顶层完全一样；Clipboard API 在不同浏览器下有权限与用户手势差异。无法复制时保留下载或手动复制的既有降级路径。同条件下独立图可用而 atlas 不可用的功能按回归处理，不能通过隐藏按钮归类为浏览器限制。

有进行中的录制或异步导出时，显式内部导航暂缓或让读者取消；浏览器 Back 不能可靠阻止，应取消该会话任务并丢弃迟到结果，不能把新图导出成旧请求的结果。现有 Presentation Stage 是 CSS 演示模式，应协调到外层图集并保留层级导航；本次不新增原生 Fullscreen API。

## 文件与分阶段实现

建议新增少量有完整职责的文件：

- `archify/schemas/atlas.schema.json`：清单格式。
- `archify/atlas/build.mjs`：输入冻结、跨图验证、成员编译、装配及整包检查；初期不拆 resolver/registry/provider 空壳。
- `archify/assets/atlas-shell.html`：外层文档及导航会话运行时。
- `archify/test/atlas-contract.test.mjs` 与浏览器场景测试：构建契约与真实会话行为。

同时修改 CLI 交付分派、schema 校验器生成清单、architecture 的内部图集标记参数，以及现有 template 的启动/地址/恢复连接。既有单图 checker 保持严格。

实现可按三个阶段连续推进；阶段划分不代表可以提前完成目标：

1. 清单与整包编译。产出可解包核对的候选，验证三层树、共享引用和失败保留旧文件；能力仍标为实验性，不能宣称已完成交互。
2. 单活动会话、地址与历史。完成三层下钻、直接深链、图内状态、返回恢复和竞态处理，同时验证已有探索/导出未退化。
3. 上下文静态标记、既有能力兼容与完整本地交付。覆盖执行 Goal 的浏览器场景，补文档、示例和质量证据。发布、推送或合并不属于本次目标。

## 验收与设计消融

验收统一维护在执行 Goal 的 AC01–AC14，包括行为、明确容差及 CLI/真实浏览器/视觉证据要求，本文不再保留第二套验收表。结构面包屑和访问返回分别验证，不能把来路当成结构归属。

本轮在相同验收条件下逐项删除：动态 Portal 预览、必需过渡动画、多个 iframe 缓存、共享模板运行时拼装、全局实体表、owner/subject 重复字段、跨层通信投影。首版验收不依赖它们，保留移除。

试删会话代号会无法排除迟到消息；试删访问级快照会破坏原位返回；试删整包检查会漏掉隐藏坏成员；试删 SVG 内上下文标记会使静态图丢失引用语义。因此恢复保留四项。

这里的消融是设计走查，不是已运行的实现测试。此前执行的最小图论反例证明：把 a→X/x1 与 X/x2→b 合并成 a→X→b，会使显示图报告真实细节图中不存在的可达性；本方案通过限定图内查询避免引入该投影。

## 依据

- `archify/renderers/shared/cli.mjs`：单图装载、渲染写出和固定 primary SVG 假设。
- `archify/assets/template.html`：focus/view 等持有初始 SVG；现有地址写入、embed 模式和相机恢复能力需要调整。
- `archify/scripts/check-render-output.mjs:66`：单图 single_svg 检查。
- `archify/bin/archify.mjs`：冻结规格、同目录暂存、产物检查与 rename 交付。
- [MDN：iframe srcdoc](https://developer.mozilla.org/en-US/docs/Web/API/HTMLIFrameElement/srcdoc)
- [MDN：contentWindow 与消息来源](https://developer.mozilla.org/en-US/docs/Web/API/HTMLIFrameElement/contentWindow)
- [MDN：Clipboard API 的浏览器约束](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard_API)
