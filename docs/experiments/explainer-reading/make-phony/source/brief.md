# GNU Make: an action name can collide with a file

Primary version: GNU Make 3.81 tag resolved through GitHub to 776d8b7bc2ff83f8ebf5d357ec89e3bbe6d83962. Local executable: /usr/bin/make, GNU Make 3.81 (macOS supplied build, not a byte-verified upstream binary). Full upstream source snapshot: make-3.81.texi. Current 4.4.1 was inspected initially but the explainer should use the matching 3.81 sources below.

Pinned primary URLs:
- https://github.com/mirror/make/blob/776d8b7bc2ff83f8ebf5d357ec89e3bbe6d83962/doc/make.texi#L2591-L2650 — Phony Targets: ordinary no-prerequisite target with an existing same-name file is considered up to date; marking the target .PHONY makes its commands run regardless of that file.
- https://github.com/mirror/make/blob/776d8b7bc2ff83f8ebf5d357ec89e3bbe6d83962/doc/make.texi#L2703-L2735 — real output/prerequisite boundary and non-inheritance of phoniness.
- https://github.com/mirror/make/blob/776d8b7bc2ff83f8ebf5d357ec89e3bbe6d83962/doc/make.texi#L1947-L1960 — ordinary target is out of date if absent or older than a prerequisite.

Our probe.py creates only disposable local directories and own Makefiles. probe-1.json and probe-2.json are byte-identical, each has five cases with two actual make calls each:
1. ordinary check, same-name file absent: checked / checked.
2. ordinary check, same-name file exists: make reports up to date both times; recipe prints nothing.
3. phony check, file absent: checked / checked.
4. phony check, file exists: checked / checked; file contents preserved.
5. phony check depends on real report.txt: first call built + checked; second call checked only. Same unchanged input, report created by cp. Phoniness does not spread to the prerequisite.

The simple check recipe only prints a marker. It is not a real test suite and provides no quality or performance measurement. `up to date` here records Make's file/dependency decision, not prior completion of a check. Scope ordinary explicit make invocation, existing Makefile, no special -n/-q/-t modes. Avoid claiming a phony target always executes under every flag, repeats per dependency edge, or ignores dependency failures. Do not cover parallel builds, pattern rules, recursive make or performance.

Copyable Makefile examples need real TAB before recipe commands, not spaces. Do not give destructive cleanup commands. The two-line ordinary snippet and added `.PHONY: check` are enough to explain the collision, but retain a concise real-file boundary. No need for a diagram if code and observed outputs explain this better.
