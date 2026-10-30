# Retained evidence issues

- Author rendered one version and inspected both widths, preserving all source/HTML/logs. Horizontal graph/code/output scrolling was acknowledged rather than classified as a failed validator. No failed finalize.
- Parent candidate1 passes strict finalization and code execution but its6/6 desktop split reduces diagram labels. Candidate2 restores8/4 widths; no runtime edit.
- browser-02 used a nonexistent `.native-diagram-scroll` selector, so its `diagram: []` is missing evidence. browser-03 measures `.diagram-preview`, captures both phone extremes and is the authoritative graph measurement. Code/table/page measurements in browser-02 remain valid.
- Exact canonical HTML cmp failed after the source basename changed. Normalizing just the basename still failed: the prepared bundle digest changes with it. An expensive character-level SequenceMatcher diagnostic was interrupted; direct JSON-key comparison proves that sourcePath and digest are the only changed prepared fields and everything outside that bundle is identical. Canonical finalize and provenance checks pass. No unnormalized-byte-equality claim.
