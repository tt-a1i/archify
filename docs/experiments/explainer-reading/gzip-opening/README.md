# Explain the size with one concrete example

[Revised opening](candidate.html) · [Previous opening and three-column table](../gzip-size/candidate.html) · [Source audit and measured fixture](../gzip-size/README.md)

The previous conclusion starts by naming DEFLATE and wrapper information. The revised conclusion says what occupies space, then uses one explicitly local example: one byte becomes 21 bytes, consisting of 3 bytes of compressed data and 18 bytes of header/trailer. The reader can follow the addition before learning the format terminology. Supporting points retain two distinctions: the payload itself may grow, and equally sized inputs need not compress to the same size.

This is a parent editorial variant on branch base `5ab8f047123407ddb24f2a9aa8fd55753405db13`; refreshed `dev` remains `5ecbd1bfdbf83ea747072112493c940e707569cb`. It changes no runtime, writing rule or guide. It is not an independent generation comparison or measured human-comprehension result.

## Meaning and boundaries

All opening numbers match the existing round14 probe. The two 1024-byte samples produce 29 and 1047-byte gzip outputs, supporting the equal-input-size distinction. The original two executions are reused; no fresh probe execution or wider compression claim is made.

Title, scope, source declarations and all subsequent panels are byte-identical from `@answer` onward ([identity check](identity.json)). The 18-byte explanation remains explicitly about these samples; the unchanged body explains optional fields and multiple members. The table, source/version boundaries and practical checklist remain intact.

## Comparison and revision

The [first attempt](first-attempt.archify.md) replaced terminology with an example but added another numeric example to the second reason. It passed strict finalize and made the phone card about 30 px shorter. Parent review then replaced the awkward “补它们” wording and kept only one numeric example in the opening. The [retained first render](attempt-1/candidate.html), first metrics and screenshots remain available. Its copied receipts retain their original output paths and are historical records, not valid provenance for the relocated copy.

The final version also passes strict finalize without diagnostics. Its geometry matches the previous opening at the checked widths:

| Clean/light | Previous | Final |
| --- | ---: | ---: |
| 390 px answer-card height | 426.5 px | 426.5 px |
| 390 px summary height | 172.5 px | 172.5 px |
| 1440 px answer-card height | 428 px | 428 px |
| 1440 px summary height | 136.2 px | 136.2 px |

All panel positions and dimensions match at these widths; the table still fits its 332 px phone content area. The final edit therefore does **not** retain the first attempt's height reduction. Selection is an editorial preference for ordinary words and a concrete example, not a density improvement or a general readability score. [Raw measurements](visual-metrics.json) identify reused base captures. Parent inspected [phone](candidate-390.png), [desktop](candidate-1440.png) and [dark phone](candidate-dark-390.png) against the retained base views. Other themes/styles, narrower widths and human reading speed were not assessed.

[Current-path provenance](check.json) and [final strict receipt](candidate.finalize-summary.json) pass. No full browser gate, regression suite, ZIP rebuild, Windows check or final-head CI is claimed. The index retains both openings and the older five-column table. Disposition: retain this content alternative for human review and continue the overall goal.
