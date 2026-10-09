# ERD first-draft regressions

Unedited first drafts written from the Skill's ERD guidance (grid layout, one
domain per column, every column with its SQL type and key role, automatic
routes). None of them pinned a position, route, channel, or label point, and
every one failed `validate --quality showcase` on `dev` before the ERD
first-draft layout fixes:

| Fixture | Failure on `dev` |
| --- | --- |
| `blog.erd.json` | "written by" overlapped a table in the 56-unit gap; a vertical label sat on a cardinality glyph |
| `shop.erd.json` | four labels overlapped tables, one route crossed another, one label touched a route |
| `warehouse.erd.json` | two proper crossings from an obstacle search that ignored earlier routes, three labels over tables |

The regression test asserts that each renders at `showcase` and that the
specific defects stay fixed. A draft that passes is one valid answer, not a
layout recommendation.
