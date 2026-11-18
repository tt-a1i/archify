import { fail, preparePublication } from './attach-common.mjs';
import { locatePackBlock, replacePackBlock, sha256 } from './markdown.mjs';

// GitLab resolves this project-relative path when rendering an MR note.
const uploadPath = /^\/uploads\/[a-f0-9]{32}\/[A-Za-z0-9_.-]+\.svg$/i;
const mrPath = /^\/((?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+)\/-\/merge_requests\/([1-9]\d*)\/?$/;

function parseTarget(reference, repo, receipt) {
  let url;
  try {
    url = new URL(reference);
  } catch {
    fail('pr-attach/invalid-merge-request', 'arguments', 'Pass the full HTTPS GitLab merge request URL.');
  }
  const match = mrPath.exec(url.pathname);
  if (!match || url.protocol !== 'https:' || url.username || url.password) {
    fail('pr-attach/invalid-merge-request', 'arguments', 'Pass the full HTTPS GitLab merge request URL.');
  }
  const [, project, iid] = match;
  const repository = receipt.repository?.replace(/\/$/, '').replace(/\.git$/, '');
  if ((repo && repo !== project) || (repository && repository !== project && repository !== `${url.origin}/${project}`)) {
    fail('pr-attach/repo-mismatch', 'arguments', 'The merge request project differs from --repo or the build receipt repository.');
  }
  return { host: url.host, project, iid, webUrl: `${url.origin}/${project}/-/merge_requests/${iid}` };
}

export function attachGitLab({ pullRequest, repo, target = 'comment', dryRun, allowStale, receiptPath, receipt, markdown, glab, attachments }) {
  if (target !== 'comment') fail('cli/unsupported-option', 'arguments', 'GitLab supports --target comment.');
  if (receipt.platform !== 'gitlab' || attachments.some((asset) => asset.animated || asset.story || !asset.path.endsWith('.svg'))) {
    fail('pr-attach/gitlab-static-pack-required', 'receipt', 'Build a static pack with --platform gitlab and standalone views.');
  }
  const { host, project, iid, webUrl } = parseTarget(pullRequest, repo, receipt);
  const projectRoute = `projects/${encodeURIComponent(project)}`;
  const mrRoute = `${projectRoute}/merge_requests/${iid}`;
  const notesRoute = `${mrRoute}/notes`;
  function api(route, { args = [], input, stage = 'preflight', code = 'pr-attach/gitlab-unreadable' } = {}) {
    const result = glab({ args: ['api', '--hostname', host, route, ...args], input });
    if (result.status !== 0) fail(code, stage, `glab api failed during ${stage}: ${result.stderr.trim() || 'no diagnostic'}`);
    try {
      return JSON.parse(result.stdout);
    } catch {
      fail(code, stage, `glab api returned invalid JSON during ${stage}.`);
    }
  }
  function checkHead() {
    const mr = api(mrRoute);
    const head = mr.sha || mr.diff_refs?.head_sha;
    if (!head || !receipt.revisions?.headSha || (!allowStale && head !== receipt.revisions.headSha)) {
      fail('pr-attach/head-sha-outdated', 'preflight', 'Rebuild with a pinned headSha matching the current merge request head.');
    }
  }
  checkHead();
  const user = api('user');
  if (!Number.isSafeInteger(user.id)) fail('pr-attach/gitlab-auth', 'preflight', 'Could not identify the authenticated GitLab user.');
  function findNote() {
    for (let page = 1; ; page++) {
      const notes = api(`${notesRoute}?per_page=100&page=${page}`);
      if (!Array.isArray(notes)) fail('pr-attach/gitlab-unreadable', 'preflight', 'Expected an array of merge request notes.');
      const note = notes.find((entry) => !entry.system && entry.author?.id === user.id && locatePackBlock(entry.body));
      if (note || notes.length < 100) return note;
    }
  }
  const note = findNote();
  const { reusedUrls, uploads, finalMarkdown } = preparePublication({
    body: note?.body, attachments, markdown, receipt, url: webUrl, acceptUrl: (url) => uploadPath.test(url),
  });
  const urls = { ...reusedUrls };
  const steps = [{ step: 0, action: 'read-target', target, existingBlock: Boolean(note) }];
  const planned = {
    schemaVersion: 1, ok: true, command: 'pr attach', dryRun, target, repo: project,
    pullRequest: { number: Number(iid), url: webUrl }, receipt: receiptPath, steps,
    attachments: attachments.map(({ id, path, bytes, token }) => ({ id, path, bytes, token })),
  };
  const commentInfo = (id) => ({ id, url: `${webUrl}#note_${id}` });
  if (dryRun) {
    for (const asset of uploads) urls[asset.id] = `<project-upload:${asset.id}>`;
    const preview = finalMarkdown(urls);
    steps.push({ step: 1, action: 'skipped', reason: 'dry-run', uploads: uploads.length });
    return {
      ...planned,
      comment: note ? commentInfo(note.id) : null,
      assets: Object.fromEntries(attachments.map((asset) => [asset.path, null])),
      markdown: { preview, sha256: sha256(preview), bytes: Buffer.byteLength(preview) },
    };
  }
  for (const asset of uploads) {
    const uploaded = api(`${projectRoute}/uploads`, { args: ['-X', 'POST', '--form', `file=@${asset.path}`], stage: 'upload', code: 'pr-attach/upload-failed' });
    if (!uploadPath.test(uploaded?.url)) fail('pr-attach/upload-failed', 'upload', 'GitLab returned an invalid project upload path.');
    urls[asset.id] = uploaded.url;
  }
  steps.push({ step: 1, action: uploads.length ? 'upload' : 'skipped', attachments: uploads.length, reused: attachments.length - uploads.length });
  // Uploading can take time. Read the head and note again before publishing.
  checkHead();
  const current = findNote();
  const block = finalMarkdown(urls);
  const body = replacePackBlock(current?.body, block);
  const saved = api(current ? `${notesRoute}/${current.id}` : notesRoute, {
    args: ['-X', current ? 'PUT' : 'POST', '--input', '-'], input: JSON.stringify({ body }), stage: 'write', code: 'pr-attach/write-failed',
  });
  if (!Number.isSafeInteger(saved?.id)) fail('pr-attach/write-failed', 'write', 'GitLab did not return a note ID. Check the MR before retrying.');
  const comment = commentInfo(saved.id);
  steps.push({ step: 2, action: 'write', comment });
  return {
    ...planned,
    comment,
    assets: Object.fromEntries(attachments.map((asset) => [asset.path, urls[asset.id]])),
    markdown: { sha256: sha256(block), bytes: Buffer.byteLength(block), bodySha256: sha256(body) },
  };
}
