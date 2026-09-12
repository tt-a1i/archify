# Current focus

Stability and first-diagram reliability: an ordinary Agent's path from a bounded system description to a readable, verified diagram. Tracking issue: [#344](https://github.com/tt-a1i/archify/issues/344). Follow the **Active sequence** recorded there; this file states what is deferred and what would reopen it.

## Not now

| Item | Why deferred | What evidence would reopen it |
| --- | --- | --- |
| New diagram types (erd [#115](https://github.com/tt-a1i/archify/issues/115), cognition [#149](https://github.com/tt-a1i/archify/issues/149)) | Each renderer adds a Viewer/validator/golden surface that must stay reliable before the five existing types are. | A repository-scale real scenario that cannot be expressed by the five existing types, and a contributor who commits to owning that renderer's Viewer regressions. |
| New export formats and CLI export surfaces beyond the chosen SVG contract ([#241](https://github.com/tt-a1i/archify/issues/241), [#264](https://github.com/tt-a1i/archify/pull/264), [#272](https://github.com/tt-a1i/archify/pull/272), [#328](https://github.com/tt-a1i/archify/pull/328)) | Three parallel implementations exist for one need; the command and receipt contract is not yet agreed. | One public command/receipt contract agreed on the issue; then one primary implementation. |
| Plugin marketplaces ([#87](https://github.com/tt-a1i/archify/pull/87), [#88](https://github.com/tt-a1i/archify/issues/88)) | The ZIP distribution contract and marketplace identity/immutability rules conflict. | An issue that reconciles the ZIP contract with marketplace identity and immutability. |
| Cross-diagram drill-down / nested architecture as a large implementation ([#230](https://github.com/tt-a1i/archify/issues/230), [#262](https://github.com/tt-a1i/archify/issues/262), [#269](https://github.com/tt-a1i/archify/pull/269), [#280](https://github.com/tt-a1i/archify/issues/280), [#281](https://github.com/tt-a1i/archify/pull/281)) | The need is acknowledged; the implementations proposed so far are large and disagree on child identity. | A small agreed contract for stable child identity and evidence, before implementation. |
| Viewer broad rewrite or framework migration | Single-file deterministic delivery and installed-Skill compatibility are the constraint. [#343](https://github.com/tt-a1i/archify/issues/343) stays a bounded extraction proposal. | One concrete extraction boundary with compatibility evidence, per #343. |
| Default typography changes ([#340](https://github.com/tt-a1i/archify/issues/340), [#282](https://github.com/tt-a1i/archify/issues/282)) | Deferred by maintainer decision recorded in #344; existing zoom stays. | A maintainer decision in #344 reopening the item. |
| Broad forge adapters beyond GitHub/Gitee/local-only | [#354](https://github.com/tt-a1i/archify/pull/354) closed the bounded scope. | A hosted-forge case that local-only validation cannot cover, with a maintainer decision. |

## How work moves

- **Primary implementation:** one issue, one maintainer-designated primary PR (label `primary-implementation`), not first-come. Other PRs for the same issue are welcome as reproduction, tests, or a clearly labeled stage. Primary status lapses after 7 days without an author response to review; a maintainer may then designate another PR.
- **Small fixes:** narrow fixes and documentation/test corrections proceed without `accepted`. New schema fields, defaults, acceptance rules, install/export contracts, diagram types, or export formats need a linked issue carrying `accepted` or a recorded maintainer decision.
- **Stale:** only PRs labeled `awaiting-author` (a collaborator requested changes on the current head) age. 14 days → `stale` and a reminder; 7 more days → closed with resume instructions. Reopening is fine. Waiting on maintainer review is never stale.
- **Weekly decision window:** maintainers batch merge, close, request-evidence, and primary-designation decisions once a week; the rest of the week is asynchronous.
- **Generated artifacts:** Phase 1 active. CI rebuilds the Gallery and ZIP per PR and reports differences; the contributor contract in [CONTRIBUTING.md](../CONTRIBUTING.md#packages-and-generated-artifacts) is unchanged. Phases are defined in [docs/maintenance-roadmap.md](../docs/maintenance-roadmap.md).

## Labels

- `accepted` — maintainer agreed scope; feature/contract PRs may proceed. Maintainer-only.
- `primary-implementation` — on a PR: the maintainer-designated main implementation for its linked issue. Maintainer-only.
- `awaiting-author` — a maintainer requested changes on the current head; the stale clock runs only on this label.
- `needs-repro` — bug report lacks the minimal typed JSON reproduction or receipt.
- `not-now` — deferred per this file; reconsideration conditions apply.
- `generated-artifacts` — PR touches generated-site, package, or golden-example paths; set and removed by the triage card.
- `stale` — set by the stale workflow.

Last reviewed: 2026-09-09. Maintainers update this file directly; a PR that changes the rules it is itself subject to does not update it.

## 中文摘要

- 当前焦点：稳定性与首张图的可靠性，跟踪 issue #344，按其中的 Active sequence 推进。
- 暂不做（Not now）：新图类型（erd、cognition）；SVG 之外的新导出格式与 CLI 导出面；插件市场；跨图下钻/嵌套架构的大型实现；Viewer 大规模重写或框架迁移；默认字体排版调整；GitHub/Gitee/local-only 之外的代码托管适配。每项的重开条件见上表。
- 四条规则：
  1. 主实现：一个 issue 只有一个维护者指定的主 PR（`primary-implementation`），不按先到先得；作者 7 天未回应评审则失效。
  2. 小修复与文档/测试修正无需 `accepted`；新 schema 字段、默认值、接受规则、安装/导出契约、新图类型、新导出格式需要带 `accepted` 的 issue 或维护者书面决定。
  3. 过期：仅对 `awaiting-author` 的 PR 计时，14 天提醒，再 7 天关闭，可重开；等待维护者评审永不算过期。
  4. 每周一次决策窗口集中处理合并/关闭/补证据/指定主实现，其余时间异步。
