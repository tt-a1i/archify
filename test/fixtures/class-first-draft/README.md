# Class first-draft regressions

Unedited first drafts written from the Skill's class guidance (grid layout,
automatic routes, a short verb label on each association). None of them pinned
a position, route, or label point, and each failed `validate --quality
showcase` on `dev` before the class first-draft routing and label fixes:

| Fixture | Failure on `dev` |
| --- | --- |
| `notifications.class.json` | "records to" crossed the "has" route and sat 2 units from a route |
| `repository.class.json` | "publishes" crossed "creates" through the gap under OrderService, and its label overlapped the Order type |
| `shapes.class.json` | "包含" (contains) sat on the inheritance trunk, inside the route clearance |

The regression test asserts that each renders at `showcase` and that the
specific defects stay fixed. A draft that passes is one valid answer, not a
layout recommendation.
