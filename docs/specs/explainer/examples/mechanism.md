# 缓存未命中时，请求为什么变慢？ {#mechanism}

缓存未命中后，请求要多等**数据库查询和同步写回缓存**两段。

- 命中时，接口读到缓存值就能返回。
- 未命中时，接口必须先拿到数据库结果。
- 同步写回位于响应之前，写完缓存才能结束请求。

@answer scope="旁路缓存 · 同步写回后再响应 · 无并行与重试 · 慢多少以实测为准"
@meta locale=zh-CN
@source get-doc title="Redis GET：不存在的键返回空值" url=https://redis.io/docs/latest/commands/get/
@source set-doc title="Redis SET：设置键值" url=https://redis.io/docs/latest/commands/set/

## 一次未命中，时间花在哪？ {#timeline}

@steps id=cache-path-steps
| get-step | 读取缓存 | GET返回空值，接口继续向数据库查询。[](source:get-doc) |
| query-step | 查询PostgreSQL | 等待数据库执行SQL并返回结果。 |
| set-step | 同步写回Redis | SET完成后，接口返回响应。[](source:set-doc) |

## 命中和未命中，差在哪几步？ {#diff}

@comparison id=cache-comparison columns=命中,未命中
| 读Redis | 取得值 {good:直接返回} | 取得空值 {caution:继续查询} |
| 查PostgreSQL | 跳过 {good:省去查询} | 等待结果 {caution:增加等待} |
| 写回Redis | 跳过 {good:省去写回} | 同步SET {caution:增加等待} |
| 响应路径 | 一段读取 {good:路径短} | 三段顺序等待 {caution:路径长} |

## 想缩短等待，先查什么？ {#checks}

- 记录`cache=hit`或`cache=miss`，区分请求路径。
- 分别观察GET、SQL和SET耗时，先处理最慢的一段。
- 检查SQL索引与执行计划；改为异步写回前，设计写入失败的恢复流程。

```bash title="先看命中率"
redis-cli INFO stats | grep -E 'keyspace_(hits|misses)'
```
