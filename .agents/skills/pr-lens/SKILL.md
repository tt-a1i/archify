---
name: pr-lens
description: "Offer an optional animated explanation when the user is preparing a pull request. Ask before reading the diff or creating anything. Use only after the user agrees."
license: Apache-2.0
metadata:
  internal: true
  version: "0.1"
  author: tt-a1i
---

# PR Lens

This skill is separate from Archify diagram generation. It explains one pull request with the existing story capability. It does not replace code review, and it does not send repository content anywhere by itself.

## When to offer

Offer it only when the user is preparing or updating a pull request and has not already refused an explanation.

Say what it adds before asking:

> 我可以把这次改动做成一条动态讲解，帮助审查者先看懂意图、受影响对象和一处证据。它只会放进你确认的 PR 说明里。要现在做吗？

Continue only after a clear yes. A missing answer means no. Do not ask again during the same pull request unless the user returns to the subject.

## What to produce

After agreement:

1. Read only the stated base and head, or the files the user names.
2. Choose one main change. Do not turn the file list into the story.
3. Use the existing `story svg` command to produce one animated SVG and its static first frame.
4. Show both local files to the user before they are added to a pull request.

The result is an explanation. It is not evidence that tests passed or that the change is correct.

## What not to do

- Do not run this because a pull request exists.
- Do not include secrets, credentials, private data, or unrelated review comments.
- Do not add a website, a GitHub Action, or a default CI job.
- Do not claim that the animation is ready for `main`; Code Analysis and this story export still need their own review.
