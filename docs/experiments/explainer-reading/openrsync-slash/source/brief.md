# Source trailing slash: Apple openrsync

Actual executable: /usr/bin/rsync. It identifies itself as openrsync, protocol version 29, “rsync version 2.6.9 compatible”. This is NOT proof it is the upstream rsync 2.6.9 binary. `/usr/bin/what /usr/bin/rsync` reports PROGRAM:rsync PROJECT:rsync-184. The matching published Apple source tag rsync-184 resolves to 13eacd7e9a204b236310dab23682f6354ecc69bd. Matching project identity is not a bit-for-bit build verification.

Pinned primary source:
- https://github.com/apple-oss-distributions/rsync/blob/13eacd7e9a204b236310dab23682f6354ecc69bd/openrsync/openrsync.1#L760-L773 — -r recursively copies the source directory and subtree; with a source trailing slash, only the subtree is synchronized, not the source directory itself.
- https://github.com/apple-oss-distributions/rsync/blob/13eacd7e9a204b236310dab23682f6354ecc69bd/openrsync/openrsync.1#L972-L981 — regular files/directories in this scope; destination directory is created if absent.

Raw manual is openrsync.1 in this directory. Do not infer behavior of upstream rsync or other platform versions from a compatibility banner.

probe-1.json and probe-2.json are byte-identical actual results of probe.py. Four local constructions: source argument src or src/, destination dst already exists as an empty directory or is absent. The source holds a.txt (alpha newline), nested/b.txt (beta newline), and .hidden (hidden newline). All commands are `rsync -r -- <source> dst`. No archive flags, deletion, symlinks, filters, remote transport or metadata claim.

Observed both when dst existed and when absent:
- `rsync -r -- src dst` yields dst/src/a.txt, dst/src/nested/b.txt and dst/src/.hidden.
- `rsync -r -- src/ dst` yields dst/a.txt, dst/nested/b.txt and dst/.hidden.
- Nested and dot files are included in these constructions; source files remain intact; all exits are 0.

The useful question is which directory level lands inside dst. Source trailing slash does not mean “copy only immediate files”; recursion still carries nested/b.txt. Focus on existing empty destination for the main comparison; the absent-target observation may be a short scoped note, not another large matrix. Include implementation/version scope nearby without turning the whole page into a version essay. Actual directory trees are observations, not mock output. Code should preserve the literal slash and `--`.

An initial parent probe assumed that an absent destination would remove the src layer even without a source slash. That assumption failed against this implementation. initial-probe.py and initial-reproduction.{stdout,stderr,json} retain the failure; it is a probe expectation error, not a product defect. Do not propagate that rejected assumption. No performance or general comprehension claim follows from these runs.
