# Event Timeline Renderer

Render `diagram_type: "timeline"` JSON files into the standard Archify HTML template.

```bash
node archify/renderers/timeline/render-timeline.mjs input.timeline.json output.html
```

`--layout-json` prints the axis segments, breaks, ticks, lanes, and placed
events (with their millisecond timestamps and x positions) instead of HTML.

## Input

```json
{
  "schema_version": 1,
  "diagram_type": "timeline",
  "meta": { "title": "Payment failure incident", "evidence": "illustrative", "timezone": "Asia/Shanghai" },
  "lanes": [{ "id": "release", "label": "Release" }],
  "events": [{ "id": "deploy", "at": "2026-10-01T10:00:00+08:00", "title": "Deploy v2.4", "lane": "release" }]
}
```

- `at` is ISO 8601 with an explicit `Z` or `±HH:MM` offset (schema). An
  impossible date fails `timeline/invalid-timestamp`.
- `meta.timezone` is an IANA zone (default `UTC`) used for every tick and label;
  ticks fall on that zone's wall clock, so a `+05:30` zone ticks on its own
  hours. An unknown zone fails `timeline/invalid-timezone`.
- Across timezone-offset changes, daily ticks stay at local midnight and hourly
  ticks use real local instants. Both occurrences of a repeated hour remain;
  skipped hours or dates do not invent ticks. Event timestamps and proportional
  elapsed-time spacing are unchanged, so consecutive daily ticks can be 23 or 25
  hours apart. The existing label filter still hides text that does not fit.
- 夏令时和时区调整不会把刻度固定在时间段起点的 UTC 偏移上：日刻度保持当地
  午夜，小时刻度仅对应真实存在的当地时刻。回拨产生的两个相同墙钟时刻都保留；
  跳过的小时或整天不补造刻度。事件时间与轴上的实际时间距离不变，因此相邻
  日刻度之间可以是 23 或 25 小时；空间不足的刻度文字仍按原有规则隐藏。
- `meta.evidence` (`observed` or `illustrative`) is required and drawn as a
  badge at the top-left of the canvas.
- With `lanes`, every event names a declared lane (`timeline/unknown-lane`).
  `detail` appears in the Semantic Passport; `kind` (`change`, `alert`,
  `action`, `recovery`) colours the card and adds a legend entry.

## Axis

Events are sorted by time (ties keep authored order). x is linear in time with
one scale for the whole diagram; every lane shares the same axis, so one
instant has one x in every lane, whatever offset each timestamp was written in.

`layout.breaks: "auto"` (default) compresses a quiet period longer than 8× the
median gap between distinct timestamps and 10% of the span (at most the eight
longest that fit while preserving room for proportional time). A break is a
fixed-width hatched band with a zig-zag on the axis and
the omitted duration (`≈ 1 d 11 h`); the axis caption states how many periods
were compressed, and each break carries `data-break-ms` and an accessible label.
Inside each segment the scale is the same constant, so distances there remain
exact. `layout.breaks: "none"` draws one proportional axis. `layout.width`
(default 960) is the axis width.

## Cards

Each event is a dot on its lane line plus a card with its exact time and title.
Cards are centred on their instant and sit on either side of the lane line,
packed into rows outward from it: each takes whichever side lets it sit closest
to the line without touching an earlier card (ties go below), so simultaneous
and close events stack instead of overprinting and a burst spreads both ways.
Stems are drawn behind every card, and every dot sits on one shared halo layer, so events seconds apart merge into one outlined capsule. A card is a quiet surface with a tone accent
for its kind. Titles wrap between words. On a multi-day axis a tick names its
date only when the date changes.

## Tested size

`examples/archify-dev-activity.timeline.json` is observed data (20 tag and
merge timestamps from this repository's `origin/dev`, including events 19 s
apart, a `+05:30` committer offset, and five compressed quiet periods). It
renders in about 0.3s and passes the showcase gates.
