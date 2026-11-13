import { invalid, object } from './common.mjs';

// Input is a saved GET /repos/{owner}/{repo}/pulls/{number}/comments response,
// or { comments, headCommit?, author? }. Reading it never posts a GitHub comment.
export function parseGithubReview(report, source = {}, facts = null) {
  const comments = Array.isArray(report) ? report : report?.comments;
  if (!Array.isArray(comments)) invalid('GitHub review input must be an exported review-comments array or { comments, headCommit?, author? }.');
  comments.forEach((comment, index) => { if (!object(comment)) invalid('Each GitHub review comment must be an object.', `/${index}`); });
  const author = source.author || (!Array.isArray(report) && report.author) || null;
  if (author !== null && typeof author !== 'string') invalid('GitHub review author must be a login string.');
  const head = (!Array.isArray(report) && report.headCommit) || null;
  const analyzedHead = facts?.repository?.baseRevision || facts?.repository?.revision || null;
  const selected = author ? comments.filter(c => c.user?.login === author) : comments;
  const run = { tool: source.tool || author || 'GitHub review', version: null, records: [], files: [], notices: [], suppressed: 0, incomplete: true };
  run.notices.push({ code: 'external/review-scope', message: 'An exported review-comment list is not proof that every file was reviewed; comments remain source claims.' });
  selected.forEach((comment) => {
    const index = comments.indexOf(comment), pointer = Array.isArray(report) ? `/${index}` : `/comments/${index}`;
    if (!object(comment) || !['string', 'number'].includes(typeof comment.id) || typeof comment.body !== 'string' || !comment.body.trim()) invalid('Each review comment needs id and non-empty body.', pointer);
    if (comment.in_reply_to_id != null) return; // Discussion replies are context, not additional findings.
    if (comment.path != null && typeof comment.path !== 'string') invalid('Review comment path must be a string or null.', pointer);
    const current = comment.side === 'RIGHT' && !comment.outdated && head && analyzedHead === head && comment.commit_id === head && Number.isInteger(comment.line) && comment.line > 0;
    const location = comment.path ? { path: comment.path, noSource: !current, ...(current ? { line: comment.start_line || comment.line, endLine: comment.line } : {}) } : null;
    if (comment.path) run.files.push(comment.path);
    run.records.push({
      message: comment.body, ruleId: null, severity: 'warning', originalSeverity: null,
      locations: location ? [location] : [], pointer,
      fingerprint: `github-comment/v1:${comment.id}`,
      origin: {
        commentId: comment.id, ...(comment.html_url ? { url: comment.html_url } : {}),
        ...(comment.user?.login ? { author: comment.user.login } : {}),
        commit: comment.commit_id ?? null, originalCommit: comment.original_commit_id ?? null,
        side: comment.side ?? null, line: comment.line ?? null, originalLine: comment.original_line ?? null,
        startLine: comment.start_line ?? null, ...(comment.outdated != null ? { outdated: comment.outdated } : {}),
        ...(comment.resolved != null ? { resolved: comment.resolved } : {}),
        ...(head ? { headCommit: head } : {}),
        replies: comments.filter(c => c.in_reply_to_id === comment.id).map(c => ({ id: c.id, body: c.body, author: c.user?.login ?? null, url: c.html_url ?? null })),
      },
      suggestions: [],
    });
  });
  return [run];
}
