# Gzip size: keep the result beside the input

[Three-column explanation](candidate.html) · [Independent author's five-column version](author/answer.html)

This case explains why gzip can increase size. It separates the DEFLATE payload from the gzip header/trailer, using four fully specified byte inputs rather than a general compression-ratio claim.

## Sources and actual observations

- [RFC 1952, member format](https://www.rfc-editor.org/rfc/rfc1952.html#section-2.3) describes the fixed header, optional fields and trailer. The 18-byte addition applies to these single-member fixtures with no optional header fields; other gzip files need not have that total overhead.
- [zlib 1.2.12](https://github.com/madler/zlib/blob/21767c654d31d2dccdde4330529775c6c5fd5389/zlib.h#L565-L575) distinguishes raw DEFLATE from gzip wrapping. [Its default gzip header](https://github.com/madler/zlib/blob/21767c654d31d2dccdde4330529775c6c5fd5389/deflate.c#L892-L908) and [trailer](https://github.com/madler/zlib/blob/21767c654d31d2dccdde4330529775c6c5fd5389/deflate.c#L1092-L1102) support the byte accounting.
- [CPython 3.15.0](https://github.com/python/cpython/blob/d220409a13b77de7a6c30abe16ea90db01528edc/Lib/gzip.py#L660-L676) delegates compression to zlib and replaces header metadata. [Source identities](source-manifest.json) are pinned. The local version labels match these versions but do not establish an identical upstream binary/build.

[probe.py](probe.py) runs entirely in memory on Python 3.15.0, compiled/runtime zlib 1.2.12, with explicit level 9 and mtime 0. It verifies both round trips, the gzip flags, CRC32, ISIZE, raw-payload identity and the 10 + payload + 8 equation. [First](probe-first-output.json) and [second](probe-output.json) outputs are identical.

| Exact input | Input B | Raw DEFLATE B | Gzip B |
| --- | ---: | ---: | ---: |
| One ASCII A | 1 | 3 | 21 |
| 1024 ASCII As | 1024 | 11 | 29 |
| 1024 bytes derived by SHAKE-256 from the fixed fixture seed | 1024 | 1029 | 1047 |
| The second row's 29-byte gzip output, compressed again | 29 | 29 | 47 |

The third sample is reproducible synthetic data, not a proof about all random inputs. The fourth does not establish that every already-compressed input grows. No timing, bandwidth or security measurement is claimed.

## Reading comparison

One independent gpt-6.1-terra/medium author used frozen Archify `a3ddac350594c3db136adddf319ec7e205ee8c2a` and the retained [prompt](author-prompt.txt). Both strict finalizes passed. The author corrected an ambiguous row label after the first pass; first-draft Markdown and receipts remain available, but the first rendered HTML was not retained. This is discovery, not a generation A/B trial or a speed comparison.

The five-column table is 544 px wide inside a 332 px phone content area. Its gzip output and difference columns initially sit outside the viewport. The parent combines original/output/difference into one cell, defines the notation beside the table, and retains a separate payload column. All sixteen measured values match the probe; everything outside that table and legend is byte-identical ([comparison](comparison.json)). No reader CSS or runtime changed.

| At 390 px, clean/light | Five columns | Three columns |
| --- | ---: | ---: |
| Table / available width | 544 / 332 px | 332 / 332 px |
| Observation panel height | 574 px | 641 px |

The preferred version exposes the complete comparison without horizontal scrolling at 390 px, at the cost of about 68 px more vertical reading. At 1440 px the observation panel grows from 417 to 432 px. This is a content-specific tradeoff, not a new table default or proof of faster comprehension. See [original metrics](author-metrics.json), [candidate metrics](candidate-metrics.json), [original phone](author-examples-390.png), [candidate phone](candidate-examples-390.png), [desktop](candidate-1440.png) and [dark phone](candidate-examples-dark-390.png). Parent inspected these screenshots and the opening viewport. Narrower widths and other styles were not accepted by this check.

## Verification boundary

The candidate passes [strict finalize](candidate.finalize-summary.json) and [current-path provenance check](check.json), with zero diagnostics. The author's copied receipts retain their original absolute paths, so the [relocated provenance check fails](author/relocation-check.json); it is not rewritten to conceal that limit. One initial parent check command incorrectly included an `explainer` type argument and exited with usage status 2; the corrected public check command produced the retained provenance result.

No product source, package, authoring guide or live installation changed. No ZIP rebuild, full browser gate, full regression suite, Windows result, final-head CI or human acceptance is claimed. The review index adds both versions; [switching and matching full-page links](index-check.json) fit a 390 px outer page, and [all 36 local targets exist](index-links.json). Earlier variants retain their previous evidence rather than being revalidated here. Disposition: retain this three-column content repair and its original for review in the experimental branch, then continue the overall goal.
