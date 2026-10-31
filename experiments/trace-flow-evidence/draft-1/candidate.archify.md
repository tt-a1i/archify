# 这条跨线程连线，依据是什么？ {#trace-flow-evidence}

它来自原始记录中的同一 flow 键；78 微秒只是两个端点的时间戳差。

- 选取上游公开历史 trace 的 6 条记录，没有重新采集。
- 连线只表示记录明确声明的 flow 关联，不代表完整因果链。
- 原字段 queue_duration 为 0，其仪器化含义未核。

@answer scope="公开历史fixture · 非本轮采集 · 仅选6条记录"
@meta locale=zh-CN
@source raw title="Catapult 固定原始 trace" url=https://github.com/catapult-project/catapult/blob/6fd8bbe723677254ff1130a1a416988b8b3e285e/tracing/test_data/flow.json
@source binding title="固定 v1 flow 配对与端点绑定源码" url=https://github.com/catapult-project/catapult/blob/6fd8bbe723677254ff1130a1a416988b8b3e285e/tracing/tracing/extras/importer/trace_event_importer.html#L2107-L2350

## 连线只来自两个明示的 flow 端点 {#flow-panel span=12}

@callout level=warning title="78微秒不是工作耗时"
| 这不是本轮实测。端点差不表示 CPU、排队、网络或任务耗时，也不能据此判定关键路径。原始 queue_duration=0 按原样保留。 |

@architecture id=flow-map title="原记录的 flow 关联"
| flow-start | 记录2078 · s | backend | block:start-note | source:raw |
| flow-end | 记录2082 · f | backend | block:end-note | source:raw |
| flow-start > flow-end | 记录flow | |

@steps id=read-endpoints
| source-endpoint | 记录2078 · s | tid=23924；原 ts=1496640971731。 | flow-map | flow-start |
| destination-endpoint | 记录2082 · f | tid=23930；原 ts=1496640971809，同一 cat/name/id。 | flow-map | flow-end |

@prose id=start-note
| 原始索引2078，pid=23924，tid=23924。这个 s 记录位于源线程的 B/E 区间中。 |

@prose id=end-note
| 原始索引2082，pid=23924，tid=23930。这个 f 记录在目标线程的下一条 B 之前5微秒。不要用区间包含推断目标。 |

## 原字段与索引逐条保留 {#records span=12}

索引为原 traceEvents 数组的零起始位置，没有按名称合并。[](source:raw)

| 原索引 | pid / tid | ph | 原ts（微秒） | 原name |
| --- | --- | --- | --- | --- |
| 2077 | 23924 / 23924 | B | 1496640971725 | `SyncChannel::SendWithTimeout` |
| 2078 | 23924 / 23924 | s | 1496640971731 | `MessageLoop::PostTask` |
| 2079 | 23924 / 23924 | E | 1496640971745 | `SyncChannel::SendWithTimeout` |
| 2082 | 23924 / 23930 | f | 1496640971809 | `MessageLoop::PostTask` |
| 2083 | 23924 / 23930 | B | 1496640971814 | `MessageLoop::RunTask` |
| 2084 | 23924 / 23930 | E | 1496640971839 | `MessageLoop::RunTask` |

所选 flow 的 cat 为 `task`，name 为 `MessageLoop::PostTask`，id 为 `0xafbe9607544ea9db`。完整原件中的 s/t/f 记录只有2078与2082匹配这个三元键。

## 三种时间量不要混读 {#time-meaning span=12}

| 量 | 算法或原字段 | 本选段的值 | 能说明什么 |
| --- | --- | --- | --- |
| flow端点差 | 1496640971809减1496640971731 | 78微秒 | 两个记录时间戳的差 |
| 源线程B/E区间 | 1496640971745减1496640971725 | 20微秒 | SyncChannel记录区间 |
| 目标线程B/E区间 | 1496640971839减1496640971814 | 25微秒 | RunTask记录区间 |
| queue_duration | 原始args字段 | 0 | 单位、舍入与计算含义未核 |

B/E只保留区间上下文，没有因此增加图边。原f比目标B早5微秒；固定Catapult v1在此使用下一slice绑定。图只连接原始s/f记录，不重建该slice映射。[](source:binding)

## 完整选择与原始JSON {#selection span=12}

原件5017条，选择6条，其余5011条未投影。Chrome版本为 `Chrome/30.0.1574.0`。这不是完整执行图；同名、时间先后和相关ID都不能单独生成额外因果边。

完整原件SHA-256：`b17fa02df4a8584d230ad1014ef3578c2f141795681a8c682a644cf7eaf9d1f2`。来源固定commit：`6fd8bbe723677254ff1130a1a416988b8b3e285e`。本地分支保留完整原件与许可，下面是六条记录的原字段副本。

```json title="原始字段副本；只增加index定位外壳"
[
  {
    "index": 2077,
    "event": {
      "cat": "task",
      "pid": 23924,
      "tid": 23924,
      "ts": 1496640971725,
      "ph": "B",
      "name": "SyncChannel::SendWithTimeout",
      "args": {
        "class": 11,
        "line": 340
      }
    }
  },
  {
    "index": 2078,
    "event": {
      "cat": "task",
      "pid": 23924,
      "tid": 23924,
      "ts": 1496640971731,
      "ph": "s",
      "name": "MessageLoop::PostTask",
      "args": {},
      "id": "0xafbe9607544ea9db"
    }
  },
  {
    "index": 2079,
    "event": {
      "cat": "task",
      "pid": 23924,
      "tid": 23924,
      "ts": 1496640971745,
      "ph": "E",
      "name": "SyncChannel::SendWithTimeout",
      "args": {}
    }
  },
  {
    "index": 2082,
    "event": {
      "cat": "task",
      "pid": 23924,
      "tid": 23930,
      "ts": 1496640971809,
      "ph": "f",
      "name": "MessageLoop::PostTask",
      "args": {
        "queue_duration": 0
      },
      "id": "0xafbe9607544ea9db"
    }
  },
  {
    "index": 2083,
    "event": {
      "cat": "task",
      "pid": 23924,
      "tid": 23930,
      "ts": 1496640971814,
      "ph": "B",
      "name": "MessageLoop::RunTask",
      "args": {
        "src_file": "../../ipc/ipc_channel_proxy.cc",
        "src_func": "Send"
      }
    }
  },
  {
    "index": 2084,
    "event": {
      "cat": "task",
      "pid": 23924,
      "tid": 23930,
      "ts": 1496640971839,
      "ph": "E",
      "name": "MessageLoop::RunTask",
      "args": {}
    }
  }
]
```
