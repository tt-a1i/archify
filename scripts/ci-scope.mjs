#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

// Deliberately narrow: unknown paths, test changes, and authoring inputs run full CI.
export function classifyPaths(paths) {
  return paths.length > 0 && paths.every(path =>
    /^(README(?:_EN|_ZH)?\.md|docs\/assets\/community\/[^/]+\.(?:png|svg))$/.test(path)
  ) ? 'docs' : 'full';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let scope = 'full';
  let website = true;
  if (process.env.CI_EVENT_NAME === 'pull_request') {
    const base = process.env.CI_BASE_SHA;
    if (!/^[0-9a-f]{40}$/.test(base || '')) throw new Error('Missing or invalid PR base SHA');
    // Include both sides of renames so a runtime file moved into docs cannot bypass CI.
    const diff = execFileSync('git', ['diff', '--no-renames', '--name-only', '-z', base, 'HEAD'], { encoding: 'utf8' });
    const paths = diff.split('\0').filter(Boolean);
    scope = classifyPaths(paths);
    website = paths.some(path => /^(website\/|docs\/|scripts\/|archify\/(recipes\/|package\.json|test\/site-language-continuity\.test\.mjs)|\.github\/workflows\/ci\.yml)/.test(path));
  }
  console.log(`CI scope: ${scope}`);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `scope=${scope}\nwebsite=${website}\n`);
}
