# Source and probe audit

The explanation concerns an ordinary explicit `make check` invocation. In the minimal rule, `check` has no prerequisites and the recipe only prints a marker. An existing file named `check` therefore satisfies the ordinary file target; the command is skipped. That result says nothing about whether a test previously ran. Declaring `.PHONY: check` makes the action independent of the same-name file. It does not delete or modify that file by itself.

The contrasting `check: report.txt` rule has a phony action and a real file prerequisite. The first call builds the report and prints the check marker; the second prints only the check marker. The report remains current because the input is unchanged. This confirms the source's non-inheritance boundary for the constructed case, not every dependency graph.

Primary source: GNU Make 3.81 tag, commit `776d8b7bc2ff83f8ebf5d357ec89e3bbe6d83962`, `doc/make.texi` lines 1947–1960, 2591–2650 and 2703–2735. Local executable reports GNU Make 3.81; it is the macOS supplied binary, not a bit-for-bit verified upstream build. Source bytes are retained outside the repository; `identity.json` records their hash. Initial research also checked 4.4.1, but the authored page uses the matching 3.81 source.

`probe.py` runs all five constructions twice per invocation, in temporary directories. Two complete invocations produced identical JSON. Outputs, exit codes and preservation checks are in `probe-1.json` and `probe-2.json`. No real project or user file is modified. No timing, performance or real test-suite success is measured. No parallel, recursive, implicit-pattern, special-mode or failure-propagation behavior is claimed.

Makefile examples must retain literal tab indentation at the copy boundary. Parent browser review will verify copied bytes and run representative examples. Passing strict delivery alone does not prove that tabs survive or that a person understands the difference.
