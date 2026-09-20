# Opening up the renderer: from architecture diagrams to a reusable visualization skeleton

## One line

The core does not generate a picture; it compiles relationships into an artifact that is **verifiable, interactive, traceable, and reusable**.

## 1. What gets opened

What gets opened is **extension points and a check protocol**, not a domain vocabulary or domain rules. In software-engineering terms: **open the interfaces and the invariants, not the implementations and the knowledge.**

| Seam | What it is | Status |
| --- | --- | --- |
| Carrier | where data may sit (`facts` / `links` / `media` / `labels` / `rules` / `types` / `reader`) | done |
| Check protocol | whether invariants can be declared, with one diagnostic shape | done |
| Derivation | whether values can be computed and rendered | done |
| Vocabulary | whether a document names its own kinds and wording | done |
| Provenance | whether a fact names its origin and collection time | rejected as a reader-facing field, see §7 |

The other half is subtraction: **the core collects defaults and hands out seams.** Nothing a document does not declare is required or acted on — a rule checks only the fields it names, a seam is inert until it is filled — and a document that declares nothing renders byte-for-byte as before.

## 2. Elegant change versus heavy change

The same requirement — say "an itinerary needs clock times" — can be added two ways:

| Heavy | Elegant |
| --- | --- |
| Push domain fields into the core (`start_time`, `minutes`, `dwell_minutes`) | Add a position: one generic fact bag anyone can use |
| Teach the core domain words | The core knows facts, rules, links, media; domain words live in the pack and the document only |
| Compatibility kept by memory | Compatibility kept by structure: unstated means inert, byte for byte |
| One special case per scenario | One seam serves five scenarios (travel, legal, finance, incident, procurement) |
| Irreversible, removal drags others | Pure addition, revertible, changes no existing artifact |

This is what software engineering calls **localizing change** instead of letting it spread into the core, and refusing to let **domain knowledge leak into the abstraction**.

## 3. When to change the core, when to change the pack

Three questions:

**Capability gap or knowledge gap.** If the same data can be expressed and only the way to arrange it is missing, change the pack. If the intent cannot be expressed with the current shapes at all, change the core.

**Does another domain need it.** Provenance, derived values, actions — the core. "Pick on arrival", "blue hour" — the pack.

**New field or new grammar.** A new field (area, landmark, venue) is pack vocabulary. New grammar (accumulate along a chain, compare two fields, cross-lane walks) is the core.

One asymmetric rule keeps the relationship honest: **a pack may declare what it does not want, but it may never rewrite the core's default meaning.** The core owns gesture semantics and conflict rules; a pack only asks for a place. A pack that hijacks the default click would empty the core's own focus behaviour, which is the case this rule exists to prevent.

One more rule against premature extraction: **the rule of three** — a need seen once goes into the pack; only a shape seen two or three times earns a core seam.

What we have already decided, and where it landed:

| Need | Side | Result |
| --- | --- | --- |
| Rename fixed viewer copy | seam in the core, wording in the pack | done |
| Attach actions to a spot | `links` | done |
| Attach a photo to a spot | `media` | done |
| Turn minutes into a derived clock | facts and rules | done |
| Express "pick on arrival" | **nothing changed** — pack convention | done |
| Name the kinds a domain needs | `meta.types` over seven palette slots | done |
| Let a reader keep values on a diagram | `meta.reader.slots` — the pack names the slot, its value shape and its cue; the core only stores, applies and returns values | done |
| Let those values drive the view | `meta.reader.view` names which slots dim a spot, stow it out of the chain, or allow reading one lane alone | done |
| Let the reader carry state out of the artifact | `meta.reader.store` — the artifact writes a copy of itself with an opaque `#archify-reader-state` block | done |
| Let the reader's own moment move the numbers | `meta.reader.clock` names a declared rule and three declared slots (anchor, at, dwell); the compiler ships the rule's inputs and embeds the one shared walk, and a test re-derives every drawn time from the document | done |
| Suppress framework chrome a domain does not need | `meta.reader.suppress`: the effect id belongs to the chrome that owns it, a suppressed effect is never built, and the delivery receipt records what was left out | done |
| Let a line carry a declared state | `meta.edgeStates` names the states a pack may author on an edge and the colour slot each one uses; the core owns only the condition it can report (today: a day past its ceiling), and the paint reaches the authored line, its arrow class, and nothing else | done |
| Let the axis follow the clock instead of pre-empting it | a phase may declare its extent as a clock range (`from`/`to`) instead of columns: the derived value places each stop, a band is as wide as the busiest lane needs, a band the day skipped still shows, and a number no band covers is named rather than clamped into the nearest one | done, with a measured cost — see §8 |
| Let a value carry the word for its own stretch of the clock | `meta.bands` names the vocabulary (label + two ends); `{band}` in a rule's render template, including the caption line under a label, writes the word beside the value it describes. The word rides with the moment, so it costs no width | done |

## 4. Orthogonality between seams

**Orthogonal means three things:**

- **Single owner.** One place decides each observable result — one display string, one derived value, one rendered element.
- **Declared effects.** A seam's effect is the effect it declares. An action row also spends node width; that budget is an effect, and an undeclared effect cannot be checked.
- **A declaration names the thing, not its residue.** A phase band is a range of the derived value. Declaring that range in the columns the value produced puts the geometry before the meaning, and the two drift as soon as the clock moves; the column is a result of the band, not its definition. A stop the rule never reaches declares no value and takes part in nothing, and a number no band covers is reported — never pushed into the first or the last band.
- **A copy is not the thing.** Viewer chrome clones authored geometry into its own overlays (hit rails, focus rails, flow pulses), and a clone keeps the attributes it was not told to drop while its class is replaced. A state therefore paints the arrow class the authored line was drawn with, never a bare attribute a copy also carries — the alternative turned a 24 px transparent hit rail into a solid line.
- **Composition-checkable.** Conflicts are found by the compiler, not by author care.

**Why this decides validity.** The receipt claims the artifact is complete and checked. Non-orthogonal seams drop content silently — an action row that does not fit, a second prefix stacked on one label, two packs sharing a fact name — and the receipt still says "clean". At that point the receipt no longer describes the artifact, and every artifact built on non-orthogonal seams is suspect whatever its receipt says.

## 5. The core grows verbs, not nouns

Adding a field stores more. Adding a resolver, a checker, or an aggregator makes stored things interoperate without fighting — that is computing capability, and it is the direction the core is allowed to grow in.

| Observed conflict | Capability it needs |
| --- | --- |
| Three chains can set one display string | One resolver, priority stated once, conflicts reported |
| Two accumulate rules prefix one label | A render slot with exactly one contributor |
| Fact names have no scope | Namespace resolution, declared per rule |
| An action row is dropped when it does not fit | Width budget joins the checks: no fit is a diagnostic, not a silent omission |
| Diagnostics short-circuit stage by stage | An aggregator that collects everything collectable and names what did not run |
| ~~Suppression is a core whitelist~~ | Done: the chrome owns its effect id and consults the document's declaration, so declaring removes the effect instead of hiding it |

Judgement for anything new: **is it a noun or a verb?** A noun must answer what it competes with; a verb exists to resolve that competition, so it can be added directly.

## 6. Acceptance criteria for a seam

1. **Unstated means identical**: default rendering matches previous bytes (every seam here passes a golden byte comparison).
2. **No domain nouns in the core.**
3. **A pack changes behavior without patching the core.**
4. **A second domain reuses the same seam with no special case.**
5. **Orthogonalization never removes content.** Count information items — nodes, actions per chain, labels, disclosures, links — before and after. A reduction needs a stated reason, and the only acceptable reason is content that should never have existed.

## 7. Rejected candidates

- **Declared gaps** (`meta.gaps`): only the model can write it, so it is self-declaration, not a record. Asking is the pack's job, disclosure is the pack's job, and enforcement already exists through rules. A second mechanism for one behaviour contradicts the repository's own rule of one canonical contract per behaviour.
- **A "verified" badge on values**: self-declaration again. A guessed coordinate opens the wrong place anyway, and a model can mint the badge. **Credibility comes from external evidence, never from a label inside the artifact.**
- **TTL tables and lineage propagation** for now: a collection timestamp on the build side is enough to re-run and diff.
- Provenance, if it returns, is a **build discipline, not a reader-facing field**: record what the script fetched — endpoint, parameters, response identity, time — beside the data, so the next run can tell what changed. A lockfile, not a badge.

## 8. Facts and rules

The core knows no domain field names. A document declares **facts** (numbers on nodes and edges) and **rules**; the compiler derives and checks.

- `accumulate` — one declared start and base value per chain, adding named facts along authored edges, rendered through a template. `scope: "chain"` follows edges across lanes.
- `window`, `sum`, `compare`, `require` — range, balancing total, two-field relation, coverage.
- Content diagnostics carry the same shape as geometry diagnostics: `code`, `subject`, `evidence`, `supportedFixes`.
- **A field exists only once declared**: an element that never declares a fact takes part in nothing and reports nothing. Strictness is opt-in via `missing: "error"`.
- **Naming something that does not exist is an error**, never a silent skip.
- **One operator upstream, free field names downstream**: a pack names its facts and slots however it likes, and the same document with different names draws the same schedule. What a pack may not do is redefine the operator — pointing the reader's clock at a rule that is not a forward walk reports `workflow/unreplayable-rule` instead of guessing.

**Bands place or they name.** The same clock range serves two jobs, and a document picks one:

- As a **phase** (clock form) it is the axis: the value places each stop, and the band words are true by construction. Measured on the Shanghai pack this needs nine columns — 1719px — against the 930px a 960px-wide reader offers, so every stop's text would project 4.3px. Honest, and unreadable at the promise.
- As `meta.bands` it is a vocabulary: `{band}` writes the word where the value already is (the caption line under a leg label is the cheapest place, since the mask width is set by the line above it). The pack keeps its six compact columns, the canvas stays at 1223px, and 6.1px of projected text survives the same gate.

The lesson is not "prefer one"; it is that alignment is worth its width only when the days actually share a clock, and five stops a day over four days do not.

## 9. Verified samples

One skeleton, eight artifacts, every one delivered with zero diagnostics and no viewport overflow: a four-day Shanghai itinerary (real durations, embedded photos, area-level open spots, undeclared hotel disclosed), a citation-verification chain, a contract-review procedure, a government-procurement contract review (15 conclusion nodes, 5 checkable rules), an incident timeline, procure-to-pay, credit-to-drawdown, and a legal deadline chain.

## 10. Upstream and downstream

**The pull request upstream carries the openness logic only**: seams, check protocol, tests, this document. No domain content.

**Domain packs stay downstream**: travel, legal, procurement, each independent. This is our own design tendency, not an imitation:

- Optional — installing one saves work; skipping it still lets anyone author JSON by hand
- Removable — removing it leaves nothing behind
- No core patching — pack vocabulary and rules ride on the seams
- Loaded on demand — read when that kind of work happens
- No required dependency — a broken pack script never blocks the core

## 11. Who generates, who consumes

Generation happens **inside the reader's own environment**: the reader hands material to an agent, and the agent uses the skeleton plus a pack to produce a static HTML file. We do not run a service.

Four hard reasons: the artifact must read offline and travel as a file; the delivery receipt requires the generation to be inspectable; queries should use the reader's own credentials; itineraries carry personal movement and should never land in our storage.

## 12. Blocker list

Not ordered by difficulty but by **real friction**: every scenario records where it got stuck, and only friction earns a next step.

**Travel**

1. ~~Reader can strike off a finished spot~~ — done.
2. Phone reading: a wide diagram scaled to the screen width leaves four lanes unreadable.
3. The base must be asked for, not guessed: an undecided hotel now stays an area-level spot and is disclosed.

**Core**

4. Orthogonality work from §4 and §5: one text resolver, fact namespaces, width budget as a diagnostic, non-short-circuiting aggregation (deferred until the friction is recorded, since aggregating costs upstream complexity and buys downstream patience, not truth).

**Other scenarios**: no friction recorded yet.

## 13. Language

Repository files are English: root documents, `docs/`, and `references/`. A Chinese variant of a document carries an explicit `.zh-CN` suffix beside its English original.

Authored artifact content is a separate matter and follows the reader: a Shanghai itinerary reads in Chinese, a Tokyo one in Japanese. `meta.locale` only selects renderer-owned viewer copy.

## 14. Explicitly not depended on

- No map MCP: links are static URLs handled by the system browser or the vendor app; queries happen at generation time only.
- No live location: tracking is over-design for an itinerary.
- **The artifact never goes online.**
