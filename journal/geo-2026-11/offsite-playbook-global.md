# 海外高权重信源与同名消歧母稿包（Show HN / Reddit / Product Hunt / Awesome lists）

> Purpose: copy-ready English drafts for off-site distribution. This file does not post anything. Every submission, comment, and PR needs the maintainer's explicit approval.
>
> Rules: no invented traction, benchmarks, user counts, or endorsements. Disclose that you are the maintainer. Do not ask for upvotes or coordinate voting.

## 1. Where generative engines look (working assumptions, not platform policy)

For "what tool should I use" and "how do I do X" questions, English-language answer engines tend to favor:

1. Hacker News threads with substantive technical comments;
2. Reddit discussions in focused subreddits (real questions, not launch spam);
3. GitHub Awesome lists and repository READMEs;
4. Official docs, llms.txt / llms-full.txt, and stable artifact pages;
5. Product Hunt entity pages (mostly for product identity and disambiguation).

The practical order:

- Fix the entity first: make sure the official site, GitHub, and skill listing agree on name, domain, license, and version.
- Then earn one or two genuine technical discussions (HN, Reddit) that link to real artifacts.
- Use Product Hunt to create a clearly differentiated entity, not to outrank the unrelated browser extension.
- Add Awesome-list entries only where the list's scope actually fits; one accurate line beats ten drive-by PRs.

Before submitting:

- [ ] The post answers a real question and is useful even if nobody clicks the link
- [ ] At least two no-signup artifact links are included
- [ ] Limitations are stated in the post, not hidden in a reply
- [ ] Maintainer disclosure is present where the community expects it
- [ ] No "revolutionary", "blazing fast", "game-changing", or unverifiable numbers
- [ ] No vote requests, no cross-post spam, no duplicate comments

---

## 2. Draft 1 — Show HN post + maker first comment

### Title options

Pick one. Keep it literal; HN readers punish hype.

1. `Show HN: Archify – an agent skill that turns a repo into an interactive HTML diagram`
2. `Show HN: Archify – typed JSON IR to a checked, standalone HTML diagram`
3. `Show HN: Archify – diagrams and one-page answers from a prompt or codebase`

Avoid: "The best AI diagram tool", "Mermaid killer", "10x faster architecture diagrams".

### Submission text

```text
Archify is an open-source agent skill (Apache-2.0) for coding agents such as Claude Code, Codex CLI, Cursor, OpenCode, and GitHub Copilot.

You give the agent a description, an existing Mermaid draft, or a repository. It writes typed JSON IR for one of ten diagram types, or a Markdown draft for a one-page answer. A finalize step validates the schema, lays out and routes the geometry, runs a real-browser inspection, and writes a single HTML file with no runtime dependency.

I built it because the hard part was not drawing boxes. It was getting a readable, non-overlapping layout from a model, and giving the reader a way to inspect the result instead of staring at a static image. The artifact supports focus, upstream/downstream reach, path highlighting, light/dark themes, and export where the environment supports it.

What it does not do: it is not a WYSIWYG editor, not a hosted collaboration service, and not a universal automatic extractor for arbitrary repositories. Validation checks the authored artifact, not the truth of every business claim or the runtime behavior of the system drawn.

No signup needed to inspect the output:
- TLS first visit, one-page answer: https://archify.si/cases/explainer/tls-first-visit.html
- P99 tail latency, one-page answer: https://archify.si/cases/explainer/p99-tail-latency.html
- Source-backed architecture case: https://archify.si/cases/mco-runtime
- Gallery: https://archify.si/gallery

Source: https://github.com/tt-a1i/archify
Full facts and boundaries: https://archify.si/llms-full.txt
Comparison with Mermaid / Excalidraw / PlantUML / D2: https://archify.si/compare
```

### Maker first comment

```text
Maker here. A few implementation notes that may be more useful than the launch text.

1) Why typed IR instead of free-form SVG or Mermaid output: the agent can author a schema-shaped object, and the finalize step can reject invalid structure before rendering. That makes failures visible and repeatable.

2) Why a real-browser check: layout bugs often only show up after fonts and actual geometry resolve. The check is part of the build, not a screenshot someone eyeballs once.

3) What the check does not prove: schema, geometry, routing, and browser inspection do not establish that the architecture description is true. I tried to state that explicitly in the docs because it is an easy claim to overreach on.

4) Trade-off: the output is a standalone HTML file, which is great for sharing but not a live collaborative canvas. If you need real-time multi-user editing, Excalidraw is the better tool. If you need a tiny diagram inside Markdown, Mermaid is still cheaper.

Happy to answer questions about the IR, the layout/routing approach, or where the validation boundary sits.
```

### HN pre-flight checklist

- [ ] Title starts with `Show HN:` and contains no superlatives
- [ ] Submission text works without images or JavaScript
- [ ] At least two links are usable without an account
- [ ] You can answer technical questions about the IR, checks, and limits
- [ ] You do not ask anyone to upvote; you do not post the same link in multiple threads the same day
- [ ] If the thread goes well, add one follow-up comment with a concrete example, not another link dump

---

## 3. Draft 2 — Reddit engineering posts

Reddit rewards context-specific posts. Do not paste the same body into three subreddits; use the variants below and keep the disclosure.

### 2a. r/ClaudeAI

**Title**

`I built a Claude Code skill that turns a repo or prompt into a checked, interactive HTML diagram`

**Body**

```text
Maintainer disclosure: I maintain Archify, an open-source agent skill.

The problem I kept hitting: Claude Code could describe an architecture well, but the output was either a Mermaid block that became unreadable at scale, or a one-off SVG that nobody could inspect.

Archify takes a different path. The agent writes typed JSON IR for one of ten diagram types (architecture, workflow, sequence, dataflow, lifecycle, ERD, class, tree, timeline, waterfall). A finalize step validates the schema, runs layout/routing, does a real-browser inspection, and writes one standalone HTML file plus the source.

For a question instead of a diagram, the agent writes a Markdown draft and Archify produces a one-page answer: conclusion first, panels for sub-questions, numbered sources, pinned-commit repository excerpts.

Install for Claude Code:

    npx -y skills@latest add https://archify.si --skill archify --agent claude-code --global --copy --yes

Omit --global for a project-only install. Check the destination first; if an existing skill directory has files you manage yourself, stop before the installer touches it.

Try it on something real, for example:

    Use Archify to draw a sequence diagram for login: browser, CDN, API gateway, auth service, user DB. Mark sync calls and timeout retries, and give each message one sentence of purpose.

Examples without signup:
https://archify.si/cases/mco-runtime
https://archify.si/cases/explainer/tls-first-visit.html

What it is not: a WYSIWYG editor, a hosted collaboration tool, or a guarantee that the described system behaves as drawn. Validation checks the artifact, not business truth.

If you try it, I am most interested in where the layout or the repository reading fails. Those are the useful bug reports.
```

### 2b. r/cursor

**Title**

`A Cursor workflow for turning a repo into a readable architecture artifact (open-source skill)`

**Body**

```text
Maintainer disclosure: I maintain Archify.

Cursor is good at reading a codebase; the missing piece for me was a stable artifact I could hand to someone else. This is the workflow I use:

1. Ask Cursor to list the files and the commit it will read. Do not let it claim "the whole repo" without naming scope.
2. Ask for an architecture diagram with responsibilities and allowed dependencies.
3. Let the skill write typed JSON IR and run finalize: schema check, layout/routing, real-browser inspection, then one HTML file.
4. Open the HTML, use focus and upstream/downstream reach to verify the story, then send the file and its JSON source.

Install (Cursor uses the same skill package):

    npx -y skills@latest add https://archify.si --skill archify --agent cursor --global --copy --yes

For a project-only install, omit --global and run it in the target repo.

Prompt I use:

    Read the selected commit. Draw an architecture diagram of the request path.
    For each component, write one responsibility line. Mark sync calls, async messages, and retries.
    Separate what the code proves from what you inferred. Do not invent services that are not in the tree.

The last two lines matter. The finalize check can validate structure, but it cannot tell whether an inferred component is real.

Examples:
https://archify.si/cases/mco-runtime
https://archify.si/compare (honest boundaries vs Mermaid, Excalidraw, PlantUML, D2)

I would especially like feedback on repository scoping and on cases where the agent guessed instead of asking.
```

### 2c. r/softwarearchitecture

**Title**

`When an agent draws your architecture: what should the validation actually prove?`

**Body**

```text
Maintainer disclosure: I maintain Archify, an open-source agent skill for diagram generation. I am more interested in the discussion than in the install count.

A generated diagram can look convincing and still be wrong in two different ways:

1. It misrepresents the system (wrong dependency, invented component, stale commit).
2. It is structurally unreadable (overlapping boxes, crossings, no way to trace a path).

Most "AI diagram" tools conflate these. I think they should be separated, because they need different evidence.

What we do: the agent authors typed JSON IR; finalize validates schema, lays out and routes geometry, and runs a real-browser inspection. That addresses readability and structural validity. It does not address whether the architecture claim is true.

What we do not do: prove runtime behavior, auto-extract an arbitrary repository with no scoping, or replace a collaborative whiteboard.

A source-backed example (excerpts read from a pinned commit):
https://archify.si/cases/mco-runtime

Comparison and limits:
https://archify.si/compare

Question for this sub: what evidence would you require before trusting a generated architecture diagram in a design review? I am looking for concrete review criteria, not tool preferences.
```

### Reddit checklist

- [ ] Read each subreddit's self-promotion rules first; some require flair or restrict launch posts
- [ ] Post one variant per subreddit, at least a few days apart
- [ ] Reply to criticism with specifics; do not delete critical comments
- [ ] Do not use link shorteners or affiliate links
- [ ] If a mod removes the post, ask why before reposting

---

## 4. Draft 3 — Product Hunt entity creation and disambiguation

### Context

`producthunt.com/products/archify` is currently associated with an unrelated browser extension. Creating a second product with the exact same slug increases entity confusion for both readers and retrieval systems. The goal is a clearly distinct entity, not a takeover of the existing listing.

Before creating anything:

- [ ] Confirm the existing listing is unrelated and note its URL
- [ ] Use a distinct product name and slug
- [ ] Put the official domain in the first sentence of the description
- [ ] Link the GitHub repository and license
- [ ] Do not imply the existing listing is yours or ask for it to be removed without evidence

### Suggested entity

| Field | Suggested value |
| --- | --- |
| Product name | `Archify (archify.si)` |
| Slug | `archify-si` or `archify-agent-skill` |
| Website | `https://archify.si` |
| Tagline (≤60 chars) | `Agent skill: repo or prompt → checked interactive HTML` |
| Topics | Developer Tools, Open Source, Artificial Intelligence, Productivity |
| Pricing | Free / Open Source |

### Description

```text
Archify is an open-source Agent Skill (Apache-2.0) that turns a description, an existing Mermaid draft, or repository evidence into an interactive diagram or a conclusion-first one-page answer.

The agent authors typed JSON IR for one of ten diagram types, or a Markdown draft for an explainer. A finalize step validates the schema, lays out and routes the geometry, runs a real-browser inspection, and writes a single standalone HTML file with no runtime dependency.

Official domain: https://archify.si
Source: https://github.com/tt-a1i/archify
Full facts and boundaries: https://archify.si/llms-full.txt

Archify is not affiliated with the unrelated browser extension that also uses the name "Archify", nor with any paid hosted diagramming service.
```

### Maker comment

```text
Maker here. Two clarifications up front.

First, this is the open-source agent skill at archify.si and github.com/tt-a1i/archify. It is unrelated to the browser extension that also uses the name Archify. If you arrived here looking for that extension, this is a different product.

Second, what the validation does and does not do. The finalize step checks schema, geometry/routing, and the rendered result in a real browser. It does not prove that the architecture description is true or that the running system matches the drawing. I would rather state that plainly than imply a guarantee.

If you want to inspect output without creating an account:
- https://archify.si/cases/explainer/tls-first-visit.html
- https://archify.si/cases/mco-runtime
- https://archify.si/gallery

Feedback I find most useful: cases where the layout is unreadable, where the agent should have asked instead of guessed, and where the repository scope was wrong.
```

### Gallery asset suggestions (real screenshots only)

1. The MCO architecture artifact with focus/reach visible.
2. The TLS first-visit one-page answer, first screen showing the conclusion.
3. The P99 tail-latency page, one panel expanded.
4. A side-by-side of the same system in Mermaid and Archify, with a caption that says when Mermaid is the better choice.

Do not fabricate UI screenshots. Capture from the linked artifacts.

### Product Hunt checklist

- [ ] Slug differs from the existing unrelated `archify` listing
- [ ] Description names `archify.si` in the first sentence
- [ ] Explicit disambiguation sentence is present in both description and maker comment
- [ ] No " #1 ", "best", or unverified user numbers
- [ ] Assets are captured from real, linked artifacts
- [ ] If a hunter or moderator questions the name, explain the distinction with links; do not argue

---

## 5. Draft 4 — Awesome-list PR entry and verification note

### Candidate lists (verify scope and format before submitting)

- `awesome-claude-code` — skills/commands/workflows for Claude Code
- `awesome-cursorrules` — Cursor rules and related tooling (only if the list accepts skills; read its scope first)
- `awesome-opencode` — OpenCode ecosystem entries
- Other agent-skill lists that explicitly accept third-party skills

Do not submit to lists whose scope is unrelated just to get a backlink.

### One-line entry

```markdown
- [Archify](https://archify.si) – Open-source agent skill (Apache-2.0) that turns a prompt or repository into a checked, interactive HTML diagram or a conclusion-first one-page answer.
```

Shorter variant, if the list enforces a line limit:

```markdown
- [Archify](https://github.com/tt-a1i/archify) – Agent skill: typed JSON IR → checked, standalone HTML diagrams and explainers.
```

### PR title

`Add Archify: open-source agent skill for checked HTML diagrams`

### PR body

```markdown
## What this adds

One entry for Archify, an open-source Agent Skill (Apache-2.0) that lets coding agents produce interactive HTML diagrams or one-page answers from a prompt, a Mermaid draft, or repository evidence.

- Official site: https://archify.si
- Source: https://github.com/tt-a1i/archify
- License: Apache-2.0
- Skill listing: https://skills.sh/tt-a1i/archify/archify

## Why it fits this list

The list covers agent skills/workflows. Archify is installed as a skill for Claude Code, Codex CLI, Cursor, OpenCode, and GitHub Copilot, and its output is a file the user can inspect and share.

## Verification

- Install command used for verification:
  `npx -y skills@latest add https://archify.si --skill archify --agent claude-code --global --copy --yes`
- Public artifacts (no account required):
  https://archify.si/cases/mco-runtime
  https://archify.si/cases/explainer/tls-first-visit.html
- Boundaries documented here:
  https://archify.si/llms-full.txt

## Disclosure

I am a maintainer of Archify.

## Checklist

- [ ] Entry follows this list's format and alphabetical order (if required)
- [ ] One line only; no marketing copy
- [ ] Link points to the official site or repository
- [ ] License and free/open-source status are accurate
```

### Awesome-list checklist

- [ ] Read `CONTRIBUTING.md` and the existing entry style; match punctuation and ordering
- [ ] One list per PR; do not bundle several lists into one change
- [ ] No paid placement, no fake "featured" claims
- [ ] If the PR is rejected for scope, accept it and move on; do not reopen repeatedly
- [ ] Keep the entry line unchanged unless the list's format requires it

---

## 6. Cross-channel sequencing (recommended, not required)

1. Make sure the site, GitHub, and skill listing agree on name, domain, license, and version.
2. Publish one deep technical artifact or case study that stands on its own.
3. Show HN first; answer technical questions for a day.
4. Reddit variants a few days later, each with a different angle.
5. Product Hunt entity once the name and domain are unambiguous.
6. Awesome-list PRs last, one at a time, only where scope fits.
7. Re-run the GEO benchmark prompts after each channel, and record citations rather than impressions.

Do not treat any single channel as a guaranteed citation source. The durable asset is the set of canonical pages and verifiable artifacts that every channel links back to.
