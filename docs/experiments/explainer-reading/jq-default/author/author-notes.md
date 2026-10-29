# Author notes

- UTC start: 2026-10-29 18:52:43 UTC.
- First draft saved byte-for-byte as `first-draft.archify.md` at 2026-10-29 18:55:01 UTC.
- First finalize: receipt reports pass for validate, deliver and check, with no diagnostics; browser check did not run. The wrapping zsh command subsequently failed because `status` is a read-only shell variable. The CLI's actual result is preserved in `finalize-1.log` and its receipts. No repair was made. `first-output.html` preserves the first artifact.
- Sources: upstream jq 1.7.1 pinned source and the supplied immutable local probe output. The local executable is jq-1.7.1-apple, not proven binary-identical to upstream. The supplied 24 cases ran twice identically. Commands use POSIX shell quoting; Windows was not verified. Outputs are filter results, not file edits. No browser inspection was performed.
