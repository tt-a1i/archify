import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { PrPackError, packDiagnostic } from './manifest.mjs';
import { PACK_END, PACK_START, PR_URL_PLACEHOLDER, fillAssets, locatePackBlock, replacePackBlock, sha256 } from './markdown.mjs';
import { readPackMetadata, setPackMetadata } from './metadata.mjs';

export const MAX_ATTACHMENTS = 50;
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const MIN_GH_VERSION = [2, 99, 0];
export const ATTACH_TARGETS = ['body', 'comment'];
const ASSET_URL_RE = 'https://github\\.com/user-attachments/assets/[A-Za-z0-9._-]+';
const TOKEN_RE = new RegExp(`!\\[archify-asset-(\\d+):([a-f0-9]{16})\\]\\((${ASSET_URL_RE})\\)`, 'g');

function fail(code, stage, message, options = {}) {
  throw new PrPackError(message, { code, stage, diagnostics: [packDiagnostic({ code, message, ...options })] });
}

// Default adapter: runs the real gh binary. Tests inject a scripted executor
// with the same shape: ({ args, input }) => { status, stdout, stderr }.
export function createGhExecutor({ binary = 'gh', cwd } = {}) {
  return ({ args, input }) => {
    const result = spawnSync(binary, args, { encoding: 'utf8', input, cwd, maxBuffer: 64 * 1024 * 1024, env: process.env });
    if (result.error) return { status: null, stdout: '', stderr: result.error.message };
    return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
  };
}

function runGh(gh, args, { input, stage, code, label } = {}) {
  const result = gh({ args, input });
  if (result.status !== 0) {
    fail(code || 'pr-attach/gh-failed', stage, `${label || `gh ${args[0]}`} failed${result.status === null ? '' : ` (exit ${result.status})`}: ${(result.stderr || result.stdout || '').trim() || 'no output'}`, {
      subject: { command: ['gh', ...args.slice(0, 3)].join(' ') },
      supportedFixes: ['run the same gh command manually to inspect the failure'],
    });
  }
  return result.stdout;
}

export function parseGhVersion(output) {
  const match = /gh version (\d+)\.(\d+)\.(\d+)/.exec(output || '');
  return match ? match.slice(1, 4).map(Number) : null;
}

export function supportsAttach(version) {
  if (!version) return false;
  for (let index = 0; index < 3; index += 1) {
    if (version[index] > MIN_GH_VERSION[index]) return true;
    if (version[index] < MIN_GH_VERSION[index]) return false;
  }
  return true;
}

export function parsePullRequest(reference, repoOption) {
  const text = String(reference ?? '').trim();
  const url = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/pull\/(\d+)(?:[/?#].*)?$/.exec(text);
  if (url) {
    if (repoOption && repoOption !== url[1]) {
      fail('pr-attach/repo-mismatch', 'arguments', `--repo ${repoOption} does not match the pull request URL repository ${url[1]}.`, { supportedFixes: ['drop --repo or make it match the URL'] });
    }
    return { number: Number(url[2]), repo: url[1] };
  }
  if (/^\d+$/.test(text)) return { number: Number(text), repo: repoOption || null };
  fail('pr-attach/invalid-pull-request', 'arguments', `"${text}" is not a pull request number or https://github.com/<owner>/<repo>/pull/<n> URL.`, { supportedFixes: ['pass the PR number with --repo owner/name, or the full PR URL'] });
  return null;
}

function loadReceipt(receiptInput) {
  const receiptPath = path.resolve(receiptInput);
  let receipt;
  try {
    receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  } catch (error) {
    fail('input/not-found', 'receipt', `Could not read build receipt ${receiptPath}: ${error.message}`, { supportedFixes: ['pass the pr-pack.receipt.json written by archify pr build'] });
  }
  if (receipt?.kind !== 'pr-pack-receipt' || !Array.isArray(receipt.assets) || !receipt.markdown?.path) {
    fail('pr-attach/invalid-receipt', 'receipt', `${receiptPath} is not an archify pr build receipt.`, { supportedFixes: ['pass the pr-pack.receipt.json written by archify pr build'] });
  }
  let markdown;
  try {
    markdown = fs.readFileSync(receipt.markdown.path, 'utf8').replace(/\n$/, '');
  } catch (error) {
    fail('pr-attach/markdown-missing', 'receipt', `Could not read the Markdown draft ${receipt.markdown.path}: ${error.message}`, { supportedFixes: ['rebuild the pack with archify pr build'] });
  }
  if (sha256(markdown) !== receipt.markdown.sha256) {
    fail('pr-attach/markdown-drifted', 'receipt', `The Markdown draft ${receipt.markdown.path} no longer matches the build receipt; rebuild before attaching.`, { supportedFixes: ['run archify pr build again instead of editing pr-pack.md by hand'] });
  }
  if (!locatePackBlock(markdown)) {
    fail('pr-attach/anchors-missing', 'receipt', 'The Markdown draft lacks the archify-pr-pack anchors.', { supportedFixes: ['rebuild the pack with archify pr build'] });
  }
  return { receiptPath, receipt, markdown };
}

function checkAttachments(assets) {
  if (assets.length > MAX_ATTACHMENTS) {
    fail('pr-attach/too-many-attachments', 'preflight', `${assets.length} attachments exceed the GitHub limit of ${MAX_ATTACHMENTS} per edit.`, {
      evidence: { attachments: assets.length, limit: MAX_ATTACHMENTS },
      supportedFixes: ['reduce the number of views or use a single theme for some views'],
    });
  }
  return assets.map((asset, index) => {
    let stat;
    try {
      stat = fs.statSync(asset.path);
    } catch (error) {
      fail('pr-attach/attachment-missing', 'preflight', `Attachment ${asset.path} is missing: ${error.message}`, { subject: { asset: asset.id }, supportedFixes: ['rebuild the pack with archify pr build'] });
    }
    if (stat.size >= MAX_ATTACHMENT_BYTES) {
      fail('pr-attach/attachment-too-large', 'preflight', `Attachment ${asset.path} is ${stat.size} bytes; GitHub rejects files of ${MAX_ATTACHMENT_BYTES} bytes or more.`, {
        subject: { asset: asset.id }, evidence: { bytes: stat.size, limit: MAX_ATTACHMENT_BYTES },
        supportedFixes: ['simplify the diagram or split it into collapsed views'],
      });
    }
    const content = fs.readFileSync(asset.path);
    const hash = sha256(content).slice(0, 16);
    return { ...asset, bytes: stat.size, token: `archify-asset-${index}:${hash}`, index, hash };
  });
}

// GitHub reads attachment references with a CommonMark parser, where a
// backslash escapes the next character and whitespace ends an unquoted
// destination. Windows receipts get forward slashes, and any path that still
// contains whitespace, parentheses, or angle brackets is wrapped in <...>.
// The same spelling is used for --attach so the reference and the upload agree.
export function portableAttachmentPath(filePath) {
  const windows = path.sep === '\\' || /^[A-Za-z]:[\\/]/.test(filePath) || filePath.startsWith('\\\\');
  return windows ? filePath.replace(/\\/g, '/') : filePath;
}

export function markdownDestination(filePath) {
  const portable = portableAttachmentPath(filePath);
  return /[\s()<>]/.test(portable) ? `<${portable.replace(/</g, '%3C').replace(/>/g, '%3E')}>` : portable;
}

function tokenBlock(attachments) {
  return [PACK_START, ...attachments.map((asset) => `![${asset.token}](${markdownDestination(asset.path)})`), PACK_END].join('\n');
}

export function extractAssetUrls(body, attachments) {
  const found = new Map();
  for (const match of String(body ?? '').matchAll(TOKEN_RE)) {
    found.set(`archify-asset-${match[1]}:${match[2]}`, match[3]);
  }
  const urls = {};
  const missing = [];
  for (const asset of attachments) {
    const url = found.get(asset.token);
    if (url) urls[asset.id] = url;
    else missing.push(asset.id);
  }
  return { urls, missing };
}

function uploadedAssetUrls(body, uploads) {
  const { urls, missing } = extractAssetUrls(body, uploads);
  if (missing.length) {
    fail('pr-attach/asset-mapping-incomplete', 'map', `${missing.length} attachments were not rewritten to user-attachments URLs: ${missing.join(', ')}.`, {
      evidence: { missing, mapped: Object.keys(urls).length },
      supportedFixes: ['retry; if it persists, check that gh rewrote the Markdown image references'],
    });
  }
  return urls;
}

function commentId(comment) {
  const match = /#issuecomment-(\d+)$/.exec(comment?.url || '');
  return match ? Number(match[1]) : null;
}

export async function attachPrPack({ pullRequest, receipt: receiptInput, target = 'body', repo, dryRun = false, allowStale = false, gh = createGhExecutor() }) {
  if (!ATTACH_TARGETS.includes(target)) {
    fail('cli/unsupported-option', 'arguments', `Unknown --target "${target}". Expected body or comment.`, { supportedFixes: ['pass --target body|comment'] });
  }
  const parsed = parsePullRequest(pullRequest, repo);
  const { receiptPath, receipt, markdown } = loadReceipt(receiptInput);
  const attachments = checkAttachments(receipt.assets);
  const steps = [];

  const version = parseGhVersion(runGh(gh, ['--version'], { stage: 'preflight', code: 'pr-attach/gh-unavailable', label: 'gh --version' }));
  if (!supportsAttach(version)) {
    fail('pr-attach/gh-version', 'preflight', `gh ${version ? version.join('.') : '(unknown version)'} does not support --attach; ${MIN_GH_VERSION.join('.')} or newer is required.`, {
      evidence: { version: version ? version.join('.') : null, required: MIN_GH_VERSION.join('.') },
      supportedFixes: ['upgrade GitHub CLI to 2.99.0 or newer'],
    });
  }
  runGh(gh, ['auth', 'status'], { stage: 'preflight', code: 'pr-attach/gh-auth', label: 'gh auth status' });
  steps.push({ step: 0, action: 'preflight', gh: version.join('.'), attachments: attachments.length });

  const repoArgs = parsed.repo ? ['--repo', parsed.repo] : [];
  const prJson = runGh(gh, ['pr', 'view', String(parsed.number), ...repoArgs, '--json', 'number,url,body,comments,headRefOid'], { stage: 'preflight', code: 'pr-attach/pr-unreadable', label: 'gh pr view' });
  let pr;
  try {
    pr = JSON.parse(prJson);
  } catch {
    fail('pr-attach/pr-unreadable', 'preflight', 'gh pr view did not return JSON.', { supportedFixes: ['check gh authentication and the PR reference'] });
  }
  const resolvedRepo = parsed.repo || /^https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/pull\//.exec(pr.url || '')?.[1] || null;
  if (!resolvedRepo) fail('pr-attach/repo-unresolved', 'preflight', 'Could not determine the repository for the pull request.', { supportedFixes: ['pass --repo owner/name'] });
  if (receipt.revisions?.headSha && receipt.revisions.headSha !== pr.headRefOid && !allowStale) {
    fail('pr-attach/head-sha-outdated', 'preflight', 'The build headSha does not match the current pull request head; rebuild against the latest pushed commit before attaching.', {
      evidence: { headSha: receipt.revisions.headSha, headRefOid: pr.headRefOid ?? null },
      supportedFixes: ['push the intended commit and rebuild against the current PR head', 'use --allow-stale only when attaching this older revision is intentional'],
    });
  }
  const originalBody = String(pr.body ?? '');
  const sticky = target === 'comment'
    ? (pr.comments || []).find((comment) => locatePackBlock(comment.body)) || null
    : null;
  const stickyId = sticky ? commentId(sticky) : null;
  if (sticky && !stickyId) fail('pr-attach/comment-id-unresolved', 'preflight', `Could not derive the comment id from ${sticky.url}.`, { supportedFixes: ['pass --target body or delete the stale comment'] });
  steps.push({ step: 0, action: 'read-target', target, existingBlock: target === 'body' ? Boolean(locatePackBlock(originalBody)) : Boolean(sticky), ...(sticky ? { comment: { id: stickyId, url: sticky.url } } : {}) });

  const cached = readPackMetadata(target === 'body' ? originalBody : sticky?.body)?.assets || {};
  const reusedUrls = {};
  const uploads = attachments.filter((asset) => {
    const url = cached[`${asset.id}:${asset.hash}`];
    if (url) reusedUrls[asset.id] = url;
    return !url;
  });
  const resolvedMarkdown = markdown.replaceAll(PR_URL_PLACEHOLDER, pr.url);
  const finalMarkdown = (urls) => setPackMetadata(fillAssets(resolvedMarkdown, urls).markdown, {
    baseSha: receipt.revisions?.baseSha ?? null,
    headSha: receipt.revisions?.headSha ?? null,
    assets: Object.fromEntries(attachments.map((asset) => [`${asset.id}:${asset.hash}`, urls[asset.id]])),
  });

  const planned = {
    schemaVersion: 1,
    ok: true,
    command: 'pr attach',
    dryRun,
    target,
    repo: resolvedRepo,
    pullRequest: { number: pr.number ?? parsed.number, url: pr.url ?? null },
    receipt: receiptPath,
    attachments: attachments.map((asset) => ({ id: asset.id, path: asset.path, bytes: asset.bytes, token: asset.token })),
  };
  if (dryRun) {
    const preview = finalMarkdown(Object.fromEntries(attachments.map((asset) => [asset.id, reusedUrls[asset.id] || `<user-attachments:${asset.id}>`])));
    return {
      ...planned,
      steps: [...steps, { step: 1, action: 'skipped', reason: 'dry-run' }, { step: 2, action: 'skipped', reason: 'dry-run' }],
      comment: sticky ? { id: stickyId, url: sticky.url } : null,
      assets: Object.fromEntries(attachments.map((asset) => [asset.path, null])),
      markdown: { sha256: sha256(preview), bytes: Buffer.byteLength(preview, 'utf8'), preview },
    };
  }

  const attachArgs = uploads.flatMap((asset) => ['--attach', portableAttachmentPath(asset.path)]);
  const ghApi = (method, route, body) => runGh(gh, ['api', '-X', method, route, ...(body === undefined ? [] : ['--input', '-'])], { input: body === undefined ? undefined : JSON.stringify(body), stage: 'write', label: `gh api ${method} ${route}` });

  if (target === 'body') {
    const stagedBody = replacePackBlock(originalBody, tokenBlock(uploads));
    let modified = false;
    const restore = () => {
      if (!modified) return null;
      const result = gh({ args: ['pr', 'edit', String(parsed.number), '--repo', resolvedRepo, '--body-file', '-'], input: originalBody });
      return { restored: result.status === 0, status: result.status, stderr: (result.stderr || '').trim() };
    };
    try {
      let urls = reusedUrls;
      if (uploads.length) {
        modified = true;
        runGh(gh, ['pr', 'edit', String(parsed.number), '--repo', resolvedRepo, '--body-file', '-', ...attachArgs], { input: stagedBody, stage: 'upload', code: 'pr-attach/upload-failed', label: 'gh pr edit --attach' });
        steps.push({ step: 1, action: 'upload', attachments: uploads.length, reused: attachments.length - uploads.length });
        const uploaded = JSON.parse(runGh(gh, ['pr', 'view', String(parsed.number), '--repo', resolvedRepo, '--json', 'body'], { stage: 'map', code: 'pr-attach/pr-unreadable', label: 'gh pr view' }));
        urls = { ...reusedUrls, ...uploadedAssetUrls(uploaded.body, uploads) };
      } else {
        steps.push({ step: 1, action: 'skipped', reason: 'assets-unchanged', reused: attachments.length });
      }
      const finalBlock = finalMarkdown(urls);
      const finalBody = replacePackBlock(originalBody, finalBlock);
      modified = true;
      runGh(gh, ['pr', 'edit', String(parsed.number), '--repo', resolvedRepo, '--body-file', '-'], { input: finalBody, stage: 'write', code: 'pr-attach/write-failed', label: 'gh pr edit' });
      steps.push({ step: 2, action: 'write', mapped: Object.keys(urls).length });
      return {
        ...planned,
        steps,
        comment: null,
        assets: Object.fromEntries(attachments.map((asset) => [asset.path, urls[asset.id]])),
        markdown: { sha256: sha256(finalBlock), bytes: Buffer.byteLength(finalBlock, 'utf8'), bodySha256: sha256(finalBody) },
      };
    } catch (error) {
      const rollback = restore();
      if (error instanceof PrPackError) {
        error.rollback = rollback;
        error.diagnostics = error.diagnostics.map((entry) => ({ ...entry, evidence: { ...(entry.evidence || {}), rollback } }));
      }
      throw error;
    }
  }

  let tempCommentId = null;
  const rollback = () => {
    if (tempCommentId === null) return null;
    const result = gh({ args: ['api', '-X', 'DELETE', `repos/${resolvedRepo}/issues/comments/${tempCommentId}`] });
    return { deletedComment: result.status === 0 ? tempCommentId : null, status: result.status, stderr: (result.stderr || '').trim() };
  };
  try {
    let urls = reusedUrls;
    let createdUrl = '';
    if (uploads.length) {
      const created = runGh(gh, ['pr', 'comment', String(parsed.number), '--repo', resolvedRepo, '--body-file', '-', ...attachArgs], { input: tokenBlock(uploads), stage: 'upload', code: 'pr-attach/upload-failed', label: 'gh pr comment --attach' });
      createdUrl = created.trim().split('\n').find((line) => /#issuecomment-\d+$/.test(line)) || '';
      tempCommentId = commentId({ url: createdUrl });
      if (tempCommentId === null) {
        fail('pr-attach/comment-id-unresolved', 'upload', `gh pr comment did not return a comment URL: ${created.trim() || 'no output'}`, { supportedFixes: ['upgrade gh or retry'] });
      }
      steps.push({ step: 1, action: 'upload', comment: { id: tempCommentId, url: createdUrl }, attachments: uploads.length, reused: attachments.length - uploads.length });
      const uploaded = JSON.parse(ghApi('GET', `repos/${resolvedRepo}/issues/comments/${tempCommentId}`));
      urls = { ...reusedUrls, ...uploadedAssetUrls(uploaded.body, uploads) };
    } else {
      steps.push({ step: 1, action: 'skipped', reason: 'assets-unchanged', reused: attachments.length });
    }
    const finalBlock = finalMarkdown(urls);
    let finalComment;
    if (sticky) {
      const finalBody = replacePackBlock(sticky.body, finalBlock);
      ghApi('PATCH', `repos/${resolvedRepo}/issues/comments/${stickyId}`, { body: finalBody });
      if (tempCommentId !== null) ghApi('DELETE', `repos/${resolvedRepo}/issues/comments/${tempCommentId}`);
      tempCommentId = null;
      finalComment = { id: stickyId, url: sticky.url, bodySha256: sha256(finalBody) };
    } else {
      if (tempCommentId === null) {
        createdUrl = runGh(gh, ['pr', 'comment', String(parsed.number), '--repo', resolvedRepo, '--body-file', '-'], { input: finalBlock, stage: 'write', code: 'pr-attach/write-failed', label: 'gh pr comment' }).trim();
        tempCommentId = commentId({ url: createdUrl });
        if (tempCommentId === null) fail('pr-attach/comment-id-unresolved', 'write', 'gh pr comment did not return a comment URL.', { supportedFixes: ['inspect the pull request comments before retrying'] });
      } else {
        ghApi('PATCH', `repos/${resolvedRepo}/issues/comments/${tempCommentId}`, { body: finalBlock });
      }
      finalComment = { id: tempCommentId, url: createdUrl, bodySha256: sha256(finalBlock) };
      tempCommentId = null;
    }
    steps.push({ step: 2, action: 'write', mapped: Object.keys(urls).length, comment: { id: finalComment.id, url: finalComment.url } });
    return {
      ...planned,
      steps,
      comment: finalComment,
      assets: Object.fromEntries(attachments.map((asset) => [asset.path, urls[asset.id]])),
      markdown: { sha256: sha256(finalBlock), bytes: Buffer.byteLength(finalBlock, 'utf8'), bodySha256: finalComment.bodySha256 },
    };
  } catch (error) {
    const result = rollback();
    if (error instanceof PrPackError) {
      error.rollback = result;
      error.diagnostics = error.diagnostics.map((entry) => ({ ...entry, evidence: { ...(entry.evidence || {}), rollback: result } }));
    }
    throw error;
  }
}
