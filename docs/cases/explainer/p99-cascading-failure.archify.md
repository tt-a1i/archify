# Why can P99 jump from 80 ms to 620 ms while the mean barely moves? {#p99-cascading-failure}

In **{{scenario}}**, the model gives a P99 of **{{metric:tail-latency}}**. It sends {{metric:database-rate}} to the database and spends about {{metric:pool-wait}} waiting for a connection on the slow path.

@answer span=12 live=latency-model scope="Illustrative steady-state model"
@meta locale=en style=product

## Where does a cache miss go? {#request-path span=8}

@scenarios id=traffic default=saturation
| case baseline | Normal cache hits | qps=1200 | hit=99 | pool=48 | singleflight=false |
| case expiry | Hot-key expiry | qps=2000 | hit=97.5 | pool=40 | singleflight=false |
| case saturation | Pool saturation | qps=4000 | hit=93.8 | pool=32 | singleflight=false |
| case recovery | Singleflight recovery | qps=4000 | hit=93.8 | pool=32 | singleflight=true |

@architecture id=requests title="Cache and database paths" scenarios=traffic
| api | API gateway | backend |
| cache | Redis cache | database |
| pool | Connection pool | backend |
| db | Postgres | database |
| api > cache |
| api > pool |
| pool > db |
| active baseline | api,cache | api~cache |
| active expiry | | api~cache,api~pool |
| active saturation | | api~pool,pool~db |
| active recovery | | api~cache,api~pool,pool~db |
| badge node:pool | utilization |
| badge edge:pool~db | database-rate |

The highlighted path shows where to look first. Cache hits stop at Redis. A miss reaches the [connection pool](node:requests.pool) before Postgres can run the query.

## What changes the load? {#inputs span=4}

@calc id=latency-model
| range qps | Incoming request rate | 200 | 5000 | 100 | 4000 | req/s |
| range hit | Cache hit rate | 85 | 99.9 | 0.1 | 93.8 | % |
| range pool | Pool capacity | 16 | 128 | 8 | 32 | connections |
| toggle singleflight | Coalesce duplicate misses | false |
| let miss | 1 - hit / 100 |
| let dbRate | qps * miss * if(singleflight, 0.28, 1) |
| let load | dbRate * .13 / pool |
| let wait | min(820, 410 * pow(min(load, 1), 8) + 410 * max(load - 1.01, 0)) |
| let tail | clamp((miss - .01) * 250, 0, 1) |
| let p50 | 24 + 6 * miss |
| let p90 | 41 + min(1, 5 * miss) * wait * .15 |
| let p95 | 60 + min(1, 10 * miss) * wait * .33 |
| let p99 | 80 + tail * (wait + 130) |
| let slowest | 220 + wait |
| let capacity | 80 + tail * 540 |
| preset sameLoad | 4,000 requests/s at 93.8% hits | qps=4000 | hit=93.8 | pool=32 |
| preset moreSlots | Expand to 64 connections | pool=64 |

Singleflight coalesces concurrent requests for the same key into one database query. This model assumes it suppresses 72% of the requests that would otherwise reach the database.

## What does the connection pool see? {#pool-pressure span=4}

@metric id=database-rate label="Database traffic" calc=latency-model bind=dbRate digits=2 unit="req/s"

@metric id=utilization label="Pool use" calc=latency-model bind="100 * load" digits=2 unit="%"
| {good} | < 70 | Headroom |
| {caution} | < 100 | Little headroom |
| {bad} | else | Saturated |

@metric id=pool-wait label="Slow-path wait" calc=latency-model bind=wait unit=ms

@metric id=tail-latency label="P99 latency" calc=latency-model bind=p99 unit=ms

## Which requests get slower? {#latency-distribution span=8}

@chart id=percentiles calc=latency-model type=bar title="Modeled response latency" unit=ms ymin=0 ymax=1100
| labels | P50 | P90 | P95 | P99 | Max |
| bar | Response time | p50 | p90 | p95 | p99 | slowest |
| line | P99 with a full pool | capacity | capacity | capacity | capacity | capacity |

The reference line holds the current hit rate fixed and shows the modeled P99 at 100% pool use. The model assumes a query holds a connection for 130 ms. Its wait curve rises with load and caps the wait at 820 ms.

## How can the mean move so little? {#mean-arithmetic span=12}

Suppose 1.5% of measured requests go from 80 ms to 620 ms and all other requests take the same time as before. The mean rises by only **8.1 ms**. The chart uses a separate, adjustable approximation of the latency distribution. Use traces and connection-pool metrics to measure a real incident.
