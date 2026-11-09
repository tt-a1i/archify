# Fresh ZIP replay

- Archive: repository-root `archify.zip`
- SHA256: `b8093e4fa7530b3298bf26bc5124cde2178043d7ee91adbcf973cca07b098d29`
- Built from commit `6adec739e` with `scripts/build-zip.sh` under official Node
  22.23.4 / bundled zlib `1.3.1-e00f703`; 405 files.
- Unpacked into a fresh directory and installed with
  `npm ci --prefix modules/code-analysis --ignore-scripts`.
- ZIP CLI identity: `rust-syn@2.0.119`, adapter revision 11,
  `rust-source-direct-v11`.

| Replay | Result |
| --- | --- |
| bytes `Buf::try_get_int` | 2/2 correct, 0 wrong, 0 missed, 0 extras |
| tracing `Layer::event_enabled` | 4/7 correct, 0 wrong, 3 named misses |
| fixture easy-wrong control | 4 references; `concrete_override` excluded; `local_deref` unknown |

The fixture references are `via_default` 7:9, macro forwarding 24:13
(`macro-generated-method`), `generic` 38:5 and `concrete_plain` 42:5. The
override call at 46:5 resolves to the override body and never appears as a
reference to the default.
