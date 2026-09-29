# Update awareness

Read this file when a `finalize` or standalone `deliver` receipt has `update.noticeRequired: true`.

Keep one compact line in the final response, in the user's language, with `installedVersion`, `availableVersion`, and the official `releaseNotes` link. Say that the installed Skill has not changed and that the user can ask to snooze or ignore the reminder. If `source` is `cache`, say that a previous check at `checkedAt` found the update. A process message or tool output does not replace this final line.
For `severity: "security"`, label it as a security update without making installation automatic or urgent by default.

You may translate the fixed local `noticeText`. Never quote, summarize, or translate the remote manifest's summary.

When the user explicitly asks to pause or stop this reminder, run `node scripts/check-update.mjs --snooze "<eventKey>"` (seven days) or `--ignore "<eventKey>"` (this exact release only) from the Skill directory with the receipt's `update.eventKey`, then report the returned status. Never run them on your own initiative; `--ack` is a no-op. These commands do not install an update, and a newer release notifies again.

The notice is information, not permission. Keep the installed version unchanged. This workflow never downloads, installs, or executes an update, and silence is never consent.
