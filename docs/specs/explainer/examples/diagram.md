# 缓存未命中时，请求经过哪些调用？ {#diagram}

缓存未命中后，**订单接口先查数据库，再写回Redis，最后返回响应**。

- 数据库负责返回订单数据，接口负责写缓存。
- 查询和写回依次执行，都在响应的等待路径上。
- 缓存命中会直接返回，跳过这两段等待。

@answer scope="旁路缓存 · 同步写回 · 不含并发与失败分支 · 图只表示先后，不表示耗时"
@meta locale=zh-CN
@source redis-get title="Redis GET命令语义" url=https://redis.io/docs/latest/commands/get/
@source redis-set title="Redis SET命令语义" url=https://redis.io/docs/latest/commands/set/

## 为什么会多等两段？ {#waits}

- GET返回空值，接口转而向数据库取数据。[](source:redis-get)
- 接口拿到结果后，再调用SET填充缓存。[](source:redis-set)
- 两次调用都完成后，浏览器才能收到响应。

## 一次未命中经过哪些调用？ {#figure}

@sequence id=cache-sequence title="一次缓存未命中的订单请求"
| actor browser | 浏览器 | frontend |
| actor api | 订单接口 | backend |
| actor redis | Redis | database |
| actor postgres | PostgreSQL | database |
| browser | api | GET /orders/42 |
| api | redis | GET order:42 |
| redis | api | nil：未命中 | return |
| api | postgres | SELECT订单 | emphasis |
| postgres | api | 结果行 | return |
| api | redis | SET order:42 value EX 300：写回 | emphasis |
| api | browser | 200 OK | return |

## 每一步发生了什么？ {#steps}

@steps id=request-steps
| request-step | 浏览器请求订单 | 请求到达接口，浏览器等待响应。 | cache-sequence | api | | browser-to-api-1 |
| read-step | 先查缓存 | GET返回空值，进入回源路径。 | cache-sequence | redis | | api-to-redis-1,redis-to-api-1 |
| database-step | 回源查数据库 | 接口等待PostgreSQL返回订单数据。 | cache-sequence | postgres | | api-to-postgres-1,postgres-to-api-1 |
| write-step | 接口同步写回缓存 | 写入由API发起，方向是API→Redis。 | cache-sequence | redis | | api-to-redis-2 |
| response-step | 接口返回响应 | 查询和同步写回完成后，返回200 OK。 | cache-sequence | browser | | api-to-browser-1 |
