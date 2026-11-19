# Archify finalize 经过哪些模块？失败时旧产物怎么保住？ {#finalize-modules}

`finalize` 是交付编排器，本身不负责绘图。它按顺序调用 `deliver → check → browser-check` 三道门，只要前一道没过就立刻停下。旧产物之所以安全，是因为新 HTML **先在同目录暂存区做完渲染和自检，最后一步才原子换入目标路径**。换入前会先备份旧文件，中途出错自动还原；就算还原也失败，旧文件仍留在恢复目录里。

- 三道门通过文件 `sha256` 和 `receiptId` 串联，确认每一步检查的都是同一份新产物。[](source:finalize-mjs)
- 提交前不改动目标文件；提交时先备份旧文件再硬链接（`linkSync`）换新，文件身份不符立即中止。[](source:commit)
- 交付锁挡住并发写入；进行中日志只要没删掉，下次运行就直接报错，绝不盲目覆盖现场。[](source:deliver)
- 保护边界在提交点：新文件一旦换入成功，后续复查失败只报错并保留诊断，不再退回旧产物。

@answer scope="Archify @ 82c47ca · bin/finalize.mjs + bin/archify.mjs · explainer 默认跳过浏览器门"
@meta locale=zh-CN repo_url=https://github.com/tt-a1i/archify repo_revision=82c47ca31d83749020ff30d6b1172248e71d255d
@source finalize-mjs title="runFinalize 编排器" path=archify/bin/finalize.mjs lines=722:1050
@source commit title="commitDeliveryPair：备份、提交、回滚" path=archify/bin/archify.mjs lines=3236:3624
@source deliver title="commandDeliver 交付主流程" path=archify/bin/archify.mjs lines=4400:5301
@source check-cmd title="check 与 provenance 检查" path=archify/bin/archify.mjs lines=5418:5659
@source recover title="recover-output.mjs 恢复入口" path=archify/bin/recover-output.mjs lines=1:41

## finalize 把一次交付拆成哪几道门？ {#gates}

原生图默认跑满三道门；explainer 先由 `prepareExplainerInput` 把草稿和外部依赖打成冻结包，默认只跑 `deliver` 和 `check`，加 `--browser-check` 才启动浏览器实测。

@workflow id=finalize-gates title="finalize 交付链路"
| role frontend | 编排与回执 |
| role backend | 暂存与原子换入 |
| role security | 独立复查 |
| lane orch | 编排层（finalize.mjs） |
| lane del | 交付层（deliver） |
| lane ver | 复查层（check / browser-check） |
| cli | 解析参数与预编译 | frontend | orch |
| snap | 快照输入并准备回执 | frontend | orch |
| del | 加锁并暂存渲染 | backend | del |
| commit | 备份旧文件并换新 | backend | del |
| chk | 严格复查产物 | security | ver |
| brw | 浏览器实测（按需） | security | ver |
| rec | 写入汇总回执 | frontend | orch |
| cli > snap | |
| snap > del | |
| del > commit | |
| commit > chk | 提交成功 |
| chk > brw | 校验通过 |
| brw > rec | |

@steps id=gate-steps
| parse | 解析参数与预编译 | `commandFinalize` 解析质量档位与输出目录；explainer 先打包冻结依赖，后续每道门前后都复核输入未变。 | finalize-gates | cli |
| snap | 快照输入并准备回执 | 记录输入文件 `sha256`，并提前锁定 `.finalize.json` 与摘要回执的目标路径。 | finalize-gates | snap |
| del | 加锁并暂存渲染 | 获取交付锁、写下进行中日志，在同目录 `.archify-delivery-*` 暂存区完成渲染与自检。 | finalize-gates | del |
| swap | 备份旧文件并换新 | `commitDeliveryPair` 先把旧产物备份到暂存区，核对文件身份无误后再硬链接换上新产物。 | finalize-gates | commit |
| chk | 严格复查产物 | 核对交付凭证与新文件哈希一致后执行 `check`；若开启浏览器门则继续跑真实 Chrome 检查，最后写出汇总回执。 | finalize-gates | chk |

## 哪一步出错，旧产物会怎样？ {#failure-matrix}

| 失败阶段 | 旧产物状态 | 保护方式 |
| --- | --- | --- |
| 参数错误、输入缺失或语法校验不过 | 原封不动 {good:安全} | 还没拿交付锁，也没向目标路径写任何文件 |
| 暂存区渲染或自检失败 | 原封不动 {good:安全} | 新 HTML 只写在 `.archify-delivery-*` 暂存区，报错退出时直接清理 |
| 原子换入中途出错 | 自动还原 {good:安全} | `commitDeliveryPair` 从 `.previous-output` 和 `.previous-provenance` 备份换回原位并复核身份 |
| 自动还原失败，或提交中途锁丢失 | 留在恢复目录 {caution:手工恢复} | 标记 `recoveryRequired` 并保留暂存目录，交给 `recover-output.mjs` 恢复 |
| 同一路径并发交付，或残留锁与日志 | 拒绝启动 {good:安全} | 报 `delivery/concurrent-attempt` 或 `lock-stale`，新交付直接停下 |
| 新文件换入后，`check` 或浏览器实测失败 | 已换成新产物 {caution:不回退} | 新文件已通过 `deliver` 自检；`finalize` 返回失败并保留诊断，但不自动回退 |

## 一次 finalize 会在磁盘上写哪些文件？ {#sidecars}

| 文件 | 作用 |
| --- | --- |
| `<out>.delivery.json` | 交付凭证：记录 `receiptId`、输入与产物的 `sha256` 及校验摘要 |
| `<out>.delivery-pending.json` | 进行中日志：暂存开始时写入、提交完成时删除；残留即代表上次交付中断 |
| `<out>.delivery-lock.json` | 交付锁：阻止同一输出路径并发写入，锁异常过期时同样拦截覆盖 |
| `<out>.browser-check.json` | 浏览器实测回执：原生图默认生成，explainer 仅在加 `--browser-check` 时生成 |
| `<out>.finalize.json` 与 `-summary.json` | 汇总回执与精简摘要：先写临时文件，核对目标路径未变后原子换入 |
| `.archify-delivery-*` 目录 | 同目录暂存区：存放输入快照、候选产物和 `.previous-*` 备份；正常结束即删，需恢复时保留 |

## 交付报错或中断后怎么处理？ {#recovery}

- [ ] 打开 `<out>.finalize-summary.json`，查看 `failedStage` 和 `diagnostics[].supportedFixes` 确认卡在哪道门
- [ ] 若回执标记 `recoveryRequired`，运行 `node archify/bin/recover-output.mjs <暂存目录>` 恢复备份的旧文件[](source:recover)
- [ ] 若提示残留锁或进行中日志，先按诊断修复并串行恢复，不要直接删除锁文件
- [ ] 若失败发生在 `check` 或 `browser-check` 阶段，目标文件已换成新版本；需要旧版时从 Git 或备份检出[](source:check-cmd)
