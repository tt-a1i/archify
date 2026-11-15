# 现在就拆微服务，值得吗？ {#comparison}

先做**模块化单体**，等模块边界稳定并出现独立扩容或发布需求，再拆服务。

- 边界仍在变化，仓库内调整接口更直接。[](source:boundaries)
- 单库事务能集中处理一致性，运维也只需维护一套部署。[](source:premium)
- 当前没有独立扩容热点，拆分还不能解决最紧迫的问题。

@answer scope="8 人团队 · 上线半年 · 边界每月调整 · 峰值约 300 QPS · 无专职 SRE"
@meta locale=zh-CN
@source boundaries title="Martin Fowler · Monolith First" url=https://martinfowler.com/bliki/MonolithFirst.html
@source premium title="Martin Fowler · Microservice Premium" url=https://martinfowler.com/bliki/MicroservicePremium.html

## 哪几项需求真正影响选择？ {#tradeoffs}

@comparison id=architecture-comparison columns=模块化单体,微服务
| 边界调整 {#boundary-row} | 仓库内调整接口 {good:改动直接} | 更新跨服务契约 {bad:协调更多} |
| 数据一致性 {#consistency-row} | 单库事务 {good:本地处理} | 设计跨服务一致性 {caution:额外设计} |
| 独立扩容 {#scale-row} | 随应用整体扩容 {caution:一起扩容} | 分别扩容热点服务 {good:按需扩容} |
| 独立发布 {#release-row} | 统一发布与回归 {caution:一起发布} | 稳定契约下各自发布 {good:各自发布} |
| 运维成本 {#ops-row} | 一套部署 {good:维护面小} | 多套部署和故障处理 {bad:维护面大} |

## 什么时候该重新评估？ {#signals}

- 某模块开始占满CPU，需要独立扩容。
- 不同团队因同一次发布互相等待。
- 模块接口稳定，跨模块改动明显减少。

## 为以后拆分，先做什么？ {#prepare}

@steps id=preparation-steps
| boundaries-step | 按业务划模块 | 模块通过公开接口调用。 |
| ownership-step | 明确数据写入责任 | 每张业务表由一个模块负责写入。 |
| pilot-step | 从最稳定的一块试起 | 先核对负载、发布需求和回滚路径。 |
