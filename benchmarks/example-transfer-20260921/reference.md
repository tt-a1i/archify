# Worked example: a small callback-driven library

Read [the complete diagram JSON](../examples/document-publisher/publisher.architecture.json)
alongside its [23-line source](../examples/document-publisher/source/publisher.mjs).
The source owns the facts; the example shows how to represent them.

Start at `publish`. The source has three resolved paths: closed, denied and published.
Compare which callbacks run on each path. `closed` skips authorization entirely;
denial follows a falsy authorization result. Both invoke `onSkip` before returning. A
callback rejection escapes rather than following the resolved success arrow.
The controller owns `closed` and `published`; its caller owns the supplied
callback implementations. `save` is a callback, not proof of storage durability.

Notice where explanations live: a short node states a role, an edge states the
condition or action, and a card carries the complete branch details. Follow one
path from entry to return/error and check that the words agree with the source.
Use this comparison on your own entry points, including early returns and
callbacks bypassed by guards. The example's branches and coordinates belong to
its source; derive your own roles, relationships and positions from your task.

For composition, the [validated desktop preview](../examples/document-publisher/preview.png)
shows the JSON at normal scale. Short labels have clear corridors and branches
sit near their controller. Read the supplied preview when helpful; the example
is already validated.
Preserve the full condition when moving supporting detail into a card. Choose
meaningful rows as topology grows so readable text survives responsive scaling.
The existing authoring defaults and full `finalize` gates remain authoritative.
