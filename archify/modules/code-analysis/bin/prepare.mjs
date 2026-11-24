#!/usr/bin/env node
// One-shot companion to serve: a portable analysis view with captured AI tasks.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DiagnosticError, receipt } from '../core/index.mjs';
import { prepareAnalysisSession, runSessionAnalysis } from './serve.mjs';

export async function prepareAnalysisView(argv, dependencies = {}) {
  return prepareAnalysisSession(argv, async (session, lock) => {
    const { summary } = await runSessionAnalysis({ ...session, openAnalysis: true }, lock, dependencies);
    return receipt('ok', { command: 'prepare', summary, diagram: session.delivered,
      html: path.join(session.out, 'analysis', 'repo.analysis.html'), resume: session.resume });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (!args.length || args[0] === '--help' || args[0] === '-h') console.log('Usage: archify code-analysis prepare <repo-root> --out <dir> [--ir <architecture.json>] [--locale en|zh-CN] [--pr <GitHub-URL-or-number>] [--repository OWNER/REPO] [--scope path] [--language ts|py|java|go|rust|c|cpp] [--config file] [--map file] [--baseline file] [--quality standard|showcase]\nPrepare an offline analysis view (optionally with an authored diagram) with captured tasks, and exit. Output: <dir>/analysis/repo.analysis.html. No local server is left running.');
  else prepareAnalysisView(args).then(result => console.log(JSON.stringify(result))).catch(error => {
    const diagnostics = error instanceof DiagnosticError ? error.diagnostics : [{ code: 'analysis/prepare-failed', severity: 'error', message: error.message, subject: {}, evidence: {}, supportedFixes: ['correct the reported input or environment, then rerun prepare'] }];
    console.log(JSON.stringify(receipt('error', { command: 'prepare', diagnostics }))); process.exitCode = 2;
  });
}
