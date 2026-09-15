// Comment-command triage proxy. Pure logic is exported for tests; the IO shell
// at the bottom only reads the issue_comment payload, calls the GitHub REST
// API, and never runs code from the commented PR.
//
// Commands (one per line, outside code fences):
//   /label a, b          add settable labels
//   /unlabel a, b        remove labels
//   /dup #N              add `duplicate` and post a candidate-duplicate note
//   /duplicate #N        alias of /dup
//   /needs-repro         add `needs-repro` and post the reproduction checklist
// There is deliberately no close command; closing stays with collaborators.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MARKER = '<!-- archify-triage-commands -->';
export const UNAUTHORIZED_REPLY =
  'Triage commands are limited to listed triagers and collaborators (.github/triage-allowlist.json).';

const WRITE_PERMISSIONS = new Set(['write', 'admin', 'maintain']);
const API = 'https://api.github.com';

function splitNames(text) {
  return text
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
}

export function parseCommands(body) {
  const commands = [];
  let inFence = false;
  for (const rawLine of String(body ?? '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (/^(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence || !line.startsWith('/')) continue;
    const match = /^\/([a-z-]+)(?:\s+(.*))?$/i.exec(line);
    if (!match) continue;
    const name = match[1].toLowerCase();
    const rest = (match[2] ?? '').trim();
    if (name === 'label' || name === 'unlabel') {
      commands.push({ command: name, args: splitNames(rest) });
    } else if (name === 'dup' || name === 'duplicate') {
      commands.push({ command: 'dup', args: rest ? [rest] : [] });
    } else if (name === 'needs-repro') {
      commands.push({ command: 'needs-repro', args: [] });
    }
    // Any other slash line is ignored so ordinary text such as "/tmp/foo" does nothing.
  }
  return commands;
}

export function authorize(actor, allowlist, permission, actorType = 'User') {
  if (!actor || actorType === 'Bot') return false;
  const users = (allowlist?.users ?? []).map((user) => user.toLowerCase());
  if (users.includes(actor.toLowerCase())) return true;
  return WRITE_PERMISSIONS.has(String(permission ?? '').toLowerCase());
}

export function needsReproReply(actor, repository) {
  const blob = `https://github.com/${repository}/blob/main`;
  return [
    `Labelled \`needs-repro\` by @${actor}. To make this report actionable, add the fields the bug report form requires (${blob}/.github/ISSUE_TEMPLATE/bug-report.yml):`,
    '- exact Archify version or commit, and the installation method',
    '- the exact command, with private path segments replaced by placeholders',
    '- the smallest redacted typed JSON that still reproduces the problem',
    '- the machine-readable receipt (`validate --json` or `deliver --json`) or the exact error',
    '- expected behavior vs actual behavior',
    `Local setup and verification steps: ${blob}/CONTRIBUTING.md#local-setup-and-verification`,
  ].join('\n');
}

export function plan(commands, allowlist, currentLabels, context = {}) {
  const { actor = '', issueNumber = 0, repository = '' } = context;
  const settable = new Set(allowlist?.settableLabels ?? []);
  const present = new Set(currentLabels ?? []);
  const add = new Set();
  const remove = new Set();
  const replies = [];
  const rejected = [];

  for (const { command, args } of commands) {
    if (command === 'label' || command === 'unlabel') {
      if (args.length === 0) {
        rejected.push({ command: `/${command}`, reason: 'no label names given' });
        continue;
      }
      for (const name of args) {
        if (!settable.has(name)) {
          rejected.push({ command: `/${command} ${name}`, reason: 'not settable via command' });
        } else if (command === 'label') {
          add.add(name);
        } else {
          remove.add(name);
        }
      }
    } else if (command === 'dup') {
      const match = /^#?(\d+)$/.exec(args[0] ?? '');
      if (!match) {
        rejected.push({ command: '/dup', reason: 'expected an issue number, for example /dup #123' });
        continue;
      }
      const target = Number(match[1]);
      if (target === Number(issueNumber)) {
        rejected.push({ command: `/dup #${target}`, reason: 'an issue cannot be a duplicate of itself' });
        continue;
      }
      add.add('duplicate');
      replies.push(
        `Marked as a candidate duplicate of #${target} by @${actor}. A maintainer will confirm and close; if this is not a duplicate, say why here.`,
      );
    } else if (command === 'needs-repro') {
      add.add('needs-repro');
      replies.push(needsReproReply(actor, repository));
    }
  }

  for (const name of [...add]) {
    if (remove.has(name)) {
      add.delete(name);
      remove.delete(name);
      rejected.push({ command: `/label ${name}`, reason: 'requested both add and remove' });
    }
  }
  // Adding a label that is already present is a no-op; skip the API call.
  // Removing an absent label is kept: the DELETE returns 404, which is ignored.
  return {
    add: [...add].filter((name) => !present.has(name)),
    remove: [...remove],
    replies,
    rejected,
  };
}

export function formatSummary(actor, result) {
  const code = (names) => names.map((name) => `\`${name}\``).join(', ');
  const lines = [MARKER, `Triage command from @${actor}:`];
  if (result.add.length) lines.push(`- Added: ${code(result.add)}`);
  if (result.remove.length) lines.push(`- Removed: ${code(result.remove)}`);
  for (const { command, reason } of result.rejected) lines.push(`- Rejected \`${command}\`: ${reason}`);
  if (!result.add.length && !result.remove.length && !result.rejected.length) lines.push('- No label changes.');
  for (const reply of result.replies) lines.push('', reply);
  return lines.join('\n');
}

export async function ghFetch(url, { method = 'GET', token, body, fetchImpl = globalThis.fetch } = {}) {
  const init = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'archify-triage-commands',
    },
  };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let response = await fetchImpl(url, init);
  if (response.status >= 500) response = await fetchImpl(url, init);
  return response;
}

async function expectOk(response, what, allowed = []) {
  if (response.ok || allowed.includes(response.status)) return response;
  throw new Error(`${what} failed: ${response.status} ${await response.text()}`);
}

async function main() {
  let event;
  try {
    event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  } catch (error) {
    console.error(`Unreadable event payload: ${error.message}`);
    process.exit(1);
  }
  const comment = event.comment;
  const issue = event.issue;
  const repository = event.repository?.full_name ?? process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (typeof comment?.body !== 'string' || !issue?.number || !repository || !token) {
    console.error('Event payload is missing comment.body, issue.number, repository, or GITHUB_TOKEN.');
    process.exit(1);
  }

  const commands = parseCommands(comment.body);
  if (commands.length === 0) {
    console.log('No recognised triage command; nothing to do.');
    return;
  }

  const allowlistPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'triage-allowlist.json');
  const allowlist = JSON.parse(fs.readFileSync(allowlistPath, 'utf8'));
  const actor = comment.user?.login ?? '';
  const issueUrl = `${API}/repos/${repository}/issues/${issue.number}`;
  const gh = (url, options = {}) => ghFetch(url, { ...options, token });

  let permission = 'none';
  if (actor) {
    const response = await gh(`${API}/repos/${repository}/collaborators/${actor}/permission`);
    if (response.ok) permission = (await response.json()).permission ?? 'none';
    else if (response.status !== 404) await expectOk(response, 'Permission lookup');
  }

  if (!authorize(actor, allowlist, permission, comment.user?.type)) {
    await expectOk(
      await gh(`${issueUrl}/comments`, { method: 'POST', body: { body: `${MARKER}\n${UNAUTHORIZED_REPLY}` } }),
      'Unauthorized reply',
    );
    console.log(`@${actor} is not authorised (permission: ${permission}); replied and stopped.`);
    return;
  }

  try {
    await gh(`${API}/repos/${repository}/issues/comments/${comment.id}/reactions`, {
      method: 'POST',
      body: { content: 'eyes' },
    });
  } catch (error) {
    console.warn(`Reaction failed (ignored): ${error.message}`);
  }

  const currentLabels = (issue.labels ?? []).map((label) => label.name);
  const result = plan(commands, allowlist, currentLabels, { actor, issueNumber: issue.number, repository });

  if (result.add.length) {
    await expectOk(await gh(`${issueUrl}/labels`, { method: 'POST', body: { labels: result.add } }), 'Add labels');
  }
  for (const name of result.remove) {
    await expectOk(
      await gh(`${issueUrl}/labels/${encodeURIComponent(name)}`, { method: 'DELETE' }),
      `Remove label ${name}`,
      [404],
    );
  }
  await expectOk(
    await gh(`${issueUrl}/comments`, { method: 'POST', body: { body: formatSummary(actor, result) } }),
    'Summary reply',
  );
  console.log(
    `Applied for @${actor}: +${JSON.stringify(result.add)} -${JSON.stringify(result.remove)} rejected=${result.rejected.length}`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
