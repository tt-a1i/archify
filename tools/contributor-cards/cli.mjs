#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { prNumber, validRepository, recordFromPull, renderCard } from './card.mjs';
import { githubClient, publishCard, commentBody } from './github.mjs';

try {
  const args = process.argv.slice(2);
  const options = { repo: process.env.GITHUB_REPOSITORY || 'tt-a1i/archify', out: 'artifacts/contributor-cards' };
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (key === '--publish') options.publish = true;
    else if (['--repo', '--pr', '--out'].includes(key) && args[i + 1] && !args[i + 1].startsWith('--')) options[key.slice(2)] = args[++i];
    else throw new Error('Usage: node tools/contributor-cards/cli.mjs --pr NUMBER [--repo OWNER/REPO] [--out DIRECTORY] [--publish]');
  }
  const repository = validRepository(options.repo);
  const number = prNumber(options.pr || process.env.CARD_PR);
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const api = githubClient(token, repository);
  const repo = await api(`/repos/${repository}`);
  const pull = await api(`/repos/${repository}/pulls/${number}`);
  if (pull.base?.ref !== repo.default_branch) throw new Error('Only PRs merged into the default branch receive cards.');
  const record = recordFromPull(pull, repository);
  if (options.publish && repo.private) throw new Error('Public image publication is supported only for public repositories.');
  const { stem } = await renderCard(record, options.out);
  await fs.writeFile(`${stem}.comment.md`, commentBody(record, `https://raw.githubusercontent.com/${repository}/contributor-cards/cards/pr-${number}.png`) + '\n');
  console.log(`Rendered ${stem}.png for @${record.author}, merged ${record.mergedAt}.`);
  if (options.publish) {
    // workflow tokens act as github-actions[bot]; local gh tokens act as the authenticated user.
    const commenter = process.env.GITHUB_ACTIONS === 'true' ? 'github-actions[bot]' : (await api('/user')).login;
    // Recheck live state after rendering before any external writes.
    const fresh = recordFromPull(await api(`/repos/${repository}/pulls/${number}`), repository);
    if (JSON.stringify(fresh) !== JSON.stringify(record)) throw new Error('PR metadata changed during rendering. Run again.');
    const result = await publishCard(api, record, await fs.readFile(`${stem}.png`), { commenter });
    await fs.writeFile(`${stem}.publication.json`, JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result));
    if (process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, `Contribution card for [PR #${number}](${record.url})\n\n![Card](${result.imageUrl})\n\n[Thank-you reply](${result.commentUrl})\n`);
  }
  if (process.env.GITHUB_OUTPUT) await fs.appendFile(process.env.GITHUB_OUTPUT, `card_directory=${path.resolve(options.out)}\n`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
