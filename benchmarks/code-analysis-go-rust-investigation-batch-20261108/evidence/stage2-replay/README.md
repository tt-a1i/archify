# Fresh-ZIP replay (stage 2)

Archive: `/tmp/archify-stage2.zip`
SHA256: `5b3ee9f516b19c20004b36f32313f3650a820a446e6ca9d9907f89cb7e18e58e`
Built with official Node `v22.23.3`, bundled zlib `1.3.1-e00f703`, via
`scripts/build-zip.sh` (405 files). Unpacked into a fresh directory, `npm ci`
installed the locked Code Analysis dependencies, and the ZIP's own CLI
(`archify/bin/archify.mjs`) ran the queries below. Sample roots and fixtures are
the same ones used by the batch runs.

| Replay | Language identity | Result |
| --- | --- | --- |
| `asref` (fixture base→head) | `rust-syn@2.0.119`, revision 8, `rust-source-direct-v8` | definition `Other::enabled` at `src/lib.rs:11`; 2 references, `32:9` and `37:5`, both `rust-inherent-source-candidate` → line 11; 0 trait candidates |
| `gin-hijack` (external interface fix) | `go-parser@1.27.2`, revision 6, `go-source-direct-v4` | definition `*responseWriter.Hijack` at `response_writer.go:111`; 0 direct references; 3 interface candidates with no concrete target |
| `echo-remove-custom-method` (Go real change) | `go-parser@1.27.2`, revision 6, `go-source-direct-v4` | definition `*routeMethods.set` at `router.go:226`; 1 reference at `860:2`, caller `setHandler`; determined `go-direct-method` |
| `tracing-subscriber-event-enabled` (Rust real change) | `rust-syn@2.0.119`, revision 8, `rust-source-direct-v8` | unpaired definition `Subscriber::event_enabled` at `subscriber.rs:305`; 4 references: `dispatcher.rs:514`, `subscriber.rs:717`, `subscriber.rs:802`, `layered.rs:145`, all trait-method candidates; `fmt/mod.rs:402` remains the documented miss |

The AsRef replay confirms the wrong-target fix with the final packaged extractor:
the baseline had 0 references when `Other::enabled` changed and 1 false reference
to `First::enabled`; the fresh ZIP has 2 correct references and 0 false ones.

Each query JSON and stderr stream is stored beside this file. The ZIP and its
unpacked tree were not committed; rebuild with `scripts/build-zip.sh` under the
canonical Node 22 toolchain to reproduce the bytes or use the source tree
directly.
