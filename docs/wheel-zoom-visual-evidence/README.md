# Pointer-anchored wheel zoom visual evidence

Browser review status: **passed** on 2026-09-02 with Google Chrome headless at
1440×900, dark theme, workflow `agent-tool-call.workflow.json`.

The source artifact was rendered from this worktree at `showcase` quality.

![Before wheel zoom](before-wheel.png)

![After one upward wheel at the pointer](after-wheel-zoomed.png)

- Before: `1x`, full workflow diagram.
- After: one `-120` real mouse-wheel event at the pointer, `1.5x`.
- The content under the pointer is preserved in the viewport; the surrounding
  diagram expands around that anchor point instead of zooming from the SVG
  center.

The regression test `archify/test/wheel-zoom.test.mjs` runs the same interaction
and asserts the pointer-anchor invariant, the reset identity transform, and that
`Ctrl+wheel` passes through without moving `Archify.view.state()`.

These PNGs are deterministic evidence artifacts; the generated HTML is not
checked in because it is already covered by the public renderer tests and would
duplicate the full viewer runtime.