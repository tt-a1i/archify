import { createHash } from 'node:crypto';
import { DATA_BRANCH, validRepository } from './card.mjs';

export function githubClient(token, repository) {
  validRepository(repository);
  if (!token) throw new Error('GH_TOKEN or GITHUB_TOKEN is required.');
  return async (route, { method = 'GET', body, allow404 = false } = {}) => {
    if (!route.startsWith('/') || route.startsWith('//')) throw new Error('Invalid GitHub route');
    const response = await fetch(`https://api.github.com${route}`, {
      method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000),
    });
    if (allow404 && response.status === 404) return null;
    if (!response.ok) throw new Error(`GitHub ${method} ${route.split('?')[0]} failed (${response.status})`);
    return response.status === 204 ? null : response.json();
  };
}
const blobSha = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
export function commentBody(record, imageUrl) {
  return `<!-- archify-contributor-card:pr-${record.number} -->\nThanks @${record.author} for contributing to Archify! Your work is now part of the project.\n\n![Archify contribution card for ${record.author}](${imageUrl})\n\n[Download your card](${imageUrl})\n\n[View contribution](${record.url})`;
}
export async function publishCard(api, record, png, { commenter = 'github-actions[bot]', verifyImage = verifyPublicImage } = {}) {
  const repository = validRepository(record.repository);
  const base = `/repos/${repository}`;
  if (!png.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || png.readUInt32BE(16) !== 1000 || png.readUInt32BE(20) !== 1500) throw new Error('Expected a 1000 x 1500 PNG');
  const files = [
    { path: `cards/pr-${record.number}.png`, bytes: png },
    { path: `cards/pr-${record.number}.json`, bytes: Buffer.from(JSON.stringify(record, null, 2) + '\n') },
  ];
  let publishedCommit;
  // Ref updates are fast-forward only. Rebuild from the latest tree if a different PR wins a race.
  for (let attempt = 0; attempt < 3; attempt++) {
    const ref = await api(`${base}/git/ref/heads/${DATA_BRANCH}`, { allow404: true });
    const commit = ref ? await api(`${base}/git/commits/${ref.object.sha}`) : null;
    const tree = commit ? await api(`${base}/git/trees/${commit.tree.sha}?recursive=1`) : { tree: [] };
    if (tree.truncated) throw new Error('Card data tree exceeds the supported size');
    const unchanged = files.every(f => tree.tree.some(e => e.path === f.path && e.sha === blobSha(f.bytes)));
    if (unchanged) { publishedCommit = ref.object.sha; break; }
    const entries = [];
    for (const file of files) {
      const blob = await api(`${base}/git/blobs`, { method: 'POST', body: { encoding: 'base64', content: file.bytes.toString('base64') } });
      entries.push({ path: file.path, mode: '100644', type: 'blob', sha: blob.sha });
    }
    const newTree = await api(`${base}/git/trees`, { method: 'POST', body: { ...(commit ? { base_tree: commit.tree.sha } : {}), tree: entries } });
    const next = await api(`${base}/git/commits`, { method: 'POST', body: { message: `Add contribution card for PR #${record.number}`, tree: newTree.sha, parents: ref ? [ref.object.sha] : [] } });
    try {
      await api(`${base}/git/${ref ? 'refs/heads/' + DATA_BRANCH : 'refs'}`, { method: ref ? 'PATCH' : 'POST', body: ref ? { sha: next.sha, force: false } : { ref: `refs/heads/${DATA_BRANCH}`, sha: next.sha } });
      publishedCommit = next.sha;
      break;
    } catch (error) {
      if (attempt === 2 || !/\((409|422)\)/.test(error.message)) throw error;
    }
  }
  // Point at the PNG blob's latest commit, so unrelated card additions do not churn old comments.
  const history = await api(`${base}/commits?sha=${DATA_BRANCH}&path=cards/pr-${record.number}.png&per_page=1`);
  const imageCommit = history[0]?.sha || publishedCommit;
  const imageUrl = `https://raw.githubusercontent.com/${repository}/${imageCommit}/cards/pr-${record.number}.png`;
  await verifyImage(imageUrl, png);
  const body = commentBody(record, imageUrl);
  const marker = `<!-- archify-contributor-card:pr-${record.number} -->`;
  let existing;
  for (let page = 1; ; page++) {
    const comments = await api(`${base}/issues/${record.number}/comments?per_page=100&page=${page}`);
    existing = comments.find(c => c.user?.login === commenter && c.body?.startsWith(marker));
    if (existing || comments.length < 100) break;
  }
  let comment;
  if (existing?.body === body) comment = existing;
  else if (existing) comment = await api(`${base}/issues/comments/${existing.id}`, { method: 'PATCH', body: { body } });
  else comment = await api(`${base}/issues/${record.number}/comments`, { method: 'POST', body: { body } });
  return { imageUrl, commentUrl: comment.html_url, commit: publishedCommit, changedComment: existing?.body !== body };
}

async function verifyPublicImage(url, png) {
  const expected = createHash('sha256').update(png).digest('hex');
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (response.ok) {
      const bytes = Buffer.from(await response.arrayBuffer());
      if (createHash('sha256').update(bytes).digest('hex') === expected) return;
    }
    if (attempt < 5) await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw new Error('Published PNG is not publicly readable yet; no comment was sent. Retry the workflow.');
}
