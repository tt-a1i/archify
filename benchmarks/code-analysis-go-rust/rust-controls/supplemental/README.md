# Supplemental compiler controls

These authored controls were added after initial development questions, not to the frozen real-sample score. Use rustc 1.89.0 --edition 2021 --crate-type lib --emit metadata on each module-paths/*/lib.rs (write output outside this directory). The selected Marker return type compiles only with the intended #[path] directory.

For custom-library, cargo check --offline --workspace checks the actual_api library name. Changing app/src/lib.rs actual_api to real_api fails; changing api/src/lib.rs to refer implicitly to actual_api::work also fails. Explicit extern crate self aliases are separate source regressions. No binaries or tests are executed. Results/logs: ../../evidence/rust/module-path-controls.json and library-name-controls.json.
