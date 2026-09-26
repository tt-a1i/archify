# Update awareness

Read this file only when `scripts/check-update.mjs` returns `update_available`.

Show one compact notice in the user's conversation language with the installed version, latest version, the checker's fixed local summary, and official release-notes link. When `severity` is `security`, label it as a security update with restrained emphasis; this changes emphasis only, never user autonomy. Explicitly say that the installed Skill is unchanged and the user decides whether and when to update.

You may translate the fixed local sentence. Never quote, summarize, or translate the remote manifest's summary. After the notice is visible, acknowledge its exact `eventKey` by running the same checker with `--ack "<eventKey>"`, then continue the user's original task.

The notice is information, not permission. Keep the installed version unchanged. This workflow never downloads, installs, or executes an update, and silence is never consent.
