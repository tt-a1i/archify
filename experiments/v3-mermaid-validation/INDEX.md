# v3.0 Mermaid → Archify Validation — Source Diagrams

5 real-world Mermaid `flowchart` diagrams used as test inputs for the v3.0 visual-quality validation experiment described in `../../ROADMAP.md` (section: Validation experiment).

All diagrams were verified present in their source repositories on **2026-04-16**.

| # | Category | Source | Nodes | Direction | Notes |
|---|---|---|---:|---|---|
| 1 | Mermaid official canonical | [mermaid-js/mermaid `flowchart.md`](https://github.com/mermaid-js/mermaid/blob/develop/packages/mermaid/src/docs/syntax/flowchart.md) | 5 | TD | Decision-loop example from official syntax docs (substituted for the 4-node `examples.md` showcase to meet the ≥5-node floor) |
| 2 | Kubernetes | [kubernetes/website `observability.md`](https://github.com/kubernetes/website/blob/main/content/en/docs/concepts/cluster-administration/observability.md) | 9 | LR | k8s log aggregation pipeline; uses subgraph for source grouping |
| 3 | Microservices | [GStones/moke-kit `README.md`](https://github.com/GStones/moke-kit/blob/main/README.md) | 12 | TD | Go game-server toolkit; 5 layered subgraphs; ships with embedded `classDef` colors that we strip for fair comparison |
| 4 | CI/CD pipeline | [HaroonKhanDotNet/hivenue-cicd `BRD.md`](https://github.com/HaroonKhanDotNet/hivenue-cicd/blob/main/BRD.md) | 10 | TD | Real Hivenue platform pipeline; includes decision diamonds and `<br>` multi-line labels |
| 5 | 3-tier web app | [broadinstitute/taiga `arch.md`](https://github.com/broadinstitute/taiga/blob/afb4840/arch.md) | 10 | TD | Broad Institute scientific data platform; 4 subgraphs (Client / App / Storage / External) |

## Diversity self-check

- **Node range**: 5 / 9 / 10 / 10 / 12 (small to medium)
- **Direction**: 4× TD + 1× LR
- **Complexity coverage**: plain (#1), subgraph (#2 #3 #5), decision diamonds (#4), embedded `classDef` styling (#3), multi-line `<br>` labels (#4)

## Output structure

```
sources/        — raw .mmd files (this directory's siblings)
output-A-stock/ — version (A): stock mmdc with default theme
output-B-themed/— version (B): mmdc with archify-style themeCSS injected
output-C-archify/ — version (C): hand-ported to archify HTML
screenshots/    — randomized & deduplicated 15-image set for blind rating
RESULT.md       — rating tables + decision record
```

## Caveats flagged for transparency

1. **Diagram 1** is from the syntax docs page, not the canonical `examples.md` showcase — that one's only 4 nodes which falls below our 5-node floor. The 5-node decision-loop is the closest "official representative" example.
2. **Diagram 2** is a *log pipeline* not a *deployment topology* — the original ask was "k8s deployment", but the kubernetes/website repo's most-prominent flowchart is this observability one. Still a real, in-use, k8s-official diagram.
3. **Diagram 4** is from a relatively unknown personal repo (HaroonKhanDotNet/hivenue-cicd) rather than a canonical CI/CD example like GitHub Actions docs. It is, however, a real CI/CD diagram for a real product, which is what the experiment requires.
4. **Diagram 3's embedded `classDef`** — for fair comparison across A/B/C, version A and B will be rendered both with and without the embedded styling (so we can see whether moke-kit's hand-tuned colors already meet the bar before archify gets involved).
