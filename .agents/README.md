# Project review Skills

These Skills support the scoped [PR improvement check](../CONTRIBUTING.md#pr-improvement-check).
They are repository files, usable without a global installation or personal filesystem paths.

| Skill | Upstream | Pinned commit | Included files |
| --- | --- | --- | --- |
| simplify-codebase | [tt-a1i/simplify-codebase](https://github.com/tt-a1i/simplify-codebase) | `f8f7084801272f46e35531dcca29bff20f1935f6` | SKILL.md, references/, agents/, LICENSE |
| test-value | [tt-a1i/test-value](https://github.com/tt-a1i/test-value) | `e111931defac959ad11ddc67b8eb2f3743d08129` | SKILL.md, references/, agents/, LICENSE |

All included files match the recorded upstream commits except the two SKILL.md
frontmatters, which add `metadata.internal: true` using Archify’s existing
maintainer-Skill convention. This keeps them available as project guidance while
excluding them from the public Skills CLI installation list. Instruction bodies,
MIT licenses, and attribution remain unchanged. simplify-codebase uses the text-only release
before the optional Cleanup Map renderer was introduced; PR preparation needs
its consumer/contract proof workflow. Its included references are complete for
this revision. Runtime diagram sources and the distributed Archify Skill remain
separate from these maintainer tools.

## Updating a source

Use a dedicated PR to select and record the new upstream commit, inspect changed
instructions and any newly introduced dependencies, and copy the complete referenced
files from that revision. Verify local links, source equality, licenses, and scope
against repository instructions. Keep these files independent of user installations;
ordinary application PRs use them as read-only guidance.
