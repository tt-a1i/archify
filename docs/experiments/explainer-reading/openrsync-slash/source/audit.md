# Source and result audit

The local `/usr/bin/rsync` is Apple openrsync: protocol 29, an rsync 2.6.9 compatibility banner, and project identifier rsync-184. The Apple published rsync-184 tag resolves to `13eacd7e9a204b236310dab23682f6354ecc69bd`. This ties the manual to a matching project identifier; it does not prove a reproducible binary build. The executable and raw source hashes are recorded in identity.json.

The matching `openrsync/openrsync.1` manual describes `-r` as traversing a directory and its subtree, with source trailing slash excluding the source directory itself (lines 760–773). It also describes creating the destination directory when absent (lines 972–981). These support the intended distinction between copying a directory level and copying its contents. The four constructions corroborate it with a regular file, nested regular file and dotfile, for an existing empty or absent destination.

Actual output under dst:

- Without the source slash: src/.hidden, src/a.txt, src/nested/b.txt.
- With the source slash: .hidden, a.txt, nested/b.txt.

Every destination file contains its original fixed content. The original source files remain intact. Two complete runs produce identical JSON, including exit status, stdout, stderr, paths and contents. Timing and metadata are not measured. The source argument is a directory, not a shell glob. There are no symlinks, filters, archive-preservation flags, deletion or remote hosts. No broader implementation comparison is established.

The first probe contained an unsupported expectation for an absent destination: it predicted no src prefix even without a trailing slash. Two initial runs stopped on that same assertion; the tool output retained the diagnostic, while stdout was empty. The exact original script is preserved as initial-probe.py; an additional recorded replay supplies initial-reproduction.stdout/stderr/json. This is a corrected probe expectation, not a changed product result or a defect in openrsync. Original assertion failure must not be counted as application failure, successful validation or faster execution.

Parent review should check that readers see both the input source argument and output root. A tree without its dst root could conceal the important directory level. The slash does not disable recursion. Demonstrations of the two copy commands must run in separate disposable fixtures to avoid mixing earlier output with a later run. Record CLI implementation identity and do not generalize the compatibility banner into an upstream version claim.
