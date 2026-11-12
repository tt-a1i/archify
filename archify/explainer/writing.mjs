/** Independently authored prose hints; no external dictionary or automatic rewriting.
 * Callers select prose entries, excluding code and URL-only fields.
 * locale sets the sentence-limit fallback; bilingual phrase rules always apply.
 */
const RULES = [
  {id: 'light-verb', pattern: /进行(?![中时])\p{Script=Han}{2}|(?:加以|予以|做出|作出)\p{Script=Han}{2}|\b(?:perform an analysis of|carry out an investigation of|make a decision|give consideration to|conduct an? (?:review|investigation|analysis) of)\b/giu,
    reason: 'A light-verb construction can obscure the action.', example: '进行检查 → 检查；做出决定 → 决定; make a decision → decide', fix: 'Use the direct action verb where it preserves the meaning; name who performs the action.'},
  {id: 'cliche', pattern: /赋能|抓手|全方位|多维度|深度融合|至关重要|不可或缺|一站式|底层逻辑|\b(?:at the end of the day|in today[’']s fast-paced world|unlock the full potential|game[- ]changer|cutting[- ]edge|seamless(?:ly)?|delve into)\b/giu,
    reason: 'This stock phrase gives little information about the concrete outcome.', example: '赋能业务 → 让客服查到订单状态; seamless → name what no longer needs a manual step', fix: 'Replace the stock phrase with the specific action or outcome the reader needs.'},
  {id: 'filler', pattern: /下面我(?:来|将)|接下来我(?:来|将)|让我(?:们)?来|总的来说|综上所述|总而言之|值得注意的是|众所周知|毋庸置疑|希望(?:这)?(?:对你|对您)有(?:所)?帮助|如有疑问|\b(?:here is an overview|let[’']s (?:dive|take a look)|in conclusion|in summary|it is worth noting that|as we all know|i hope this helps)\b/giu,
    reason: 'Opening, closing or signposting filler delays the facts.', example: '综上所述，选 A → 选 A; In summary, use A → Use A', fix: 'Delete the phrase; open with the claim and stop after the last supported point.'},
  {id: 'vague-quantity', pattern: /大量(?:请求|用户|数据)|很多(?:请求|用户|数据)|若干|尽快|\b(?:many users|a large number of requests|significantly faster|as soon as possible)\b/giu,
    reason: 'The quantity or comparison lacks a stated bound or measurement.', example: '大量请求 → 写明已知请求量或说明未测量；尽快 → 写明期限; significantly faster → give the measured comparison or say it is unmeasured', fix: 'Add a supported quantity, range, deadline or comparison basis; when unknown, state that it is unmeasured. Do not invent a number.'},
  {id: 'number-boundary', pattern: /(?<=\d\s*(?:个|次|秒|天|分钟|小时|倍|人|条|项|%|ms|MB|GB|KB|QPS)?\s*)(?:以上|以下|以内)/gu,
    reason: '“以上/以下/以内” after a number leaves the endpoint unclear.', example: '3 次以上 → 超过 3 次 / 不少于 3 次；1 秒以内 → 不超过 1 秒', fix: 'Say whether the endpoint is included: 超过/不少于, 低于/不超过.'},
  {id: 'plain-word', pattern: /\b(?:utili[sz]e[sd]?|utili[sz]ation|prior to|in order to|commence[sd]?|facilitate[sd]?|subsequently|in the event that|due to the fact that|at this point in time|endeavou?r)\b/giu,
    reason: 'A longer word replaces a common one with the same meaning.', example: 'utilize → use; prior to → before; in order to → to; due to the fact that → because', fix: 'Use the shorter common word.'},
  {id: 'redundancy', pattern: /提前预先|重复重复|基本基础|\b(?:each and every|future plans|completely eliminate)\b/giu,
    reason: 'Adjacent wording may repeat the same meaning.', example: '提前预先 → 提前; each and every → each', fix: 'Keep one expression of the meaning unless both terms carry a necessary distinction.'},
];

// Mask URL bodies without changing offsets or swallowing trailing sentence punctuation.
function proseMask(text) {
  return text.replace(/https?:\/\/[^\s<>。！？，；、：）]+/giu, value => {
    // A Markdown link's closing parenthesis is outside the URL. Preserve that
    // delimiter and any following prose, while retaining balanced URL paths.
    let depth = 0, end = value.length;
    for (let i = 0; i < value.length; i++) {
      if (value[i] === '(') depth++;
      else if (value[i] === ')') {
        if (depth === 0) { end = i; break; }
        depth--;
      }
    }
    const url = value.slice(0, end);
    const tail = url.match(/[.!?,;]+$/u)?.[0] || '';
    const maskedLength = url.length - tail.length;
    return ' '.repeat(maskedLength) + value.slice(maskedLength);
  });
}

function sentences(text) {
  const result = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const decimal = char === '.' && /\d/u.test(text[i - 1] || '') && /\d/u.test(text[i + 1] || '');
    const paragraph = char === '\n' && /^\s*\n/u.test(text.slice(i + 1));
    if ((/[.!?。！？]/u.test(char) && !decimal) || paragraph) {
      result.push({text: text.slice(start, i + 1), offset: start});
      start = i + 1;
    }
  }
  if (start < text.length) result.push({text: text.slice(start), offset: start});
  return result;
}

/**
 * @param {Array<{text:string,line:number,component:string,panelId?:string}>} entries
 * @param {{mode?:'warn'|'strict'|'off',locale?:string,sentenceLimits?:{zh?:number,en?:number}}} options
 * @returns {Array<object>} Existing Archify diagnostics (warning by default).
 * Length is Han characters plus English words/numeric tokens; punctuation is excluded.
 * A sentence containing Han uses zh limit (50), otherwise en limit (28).
 */
export function lintExplainerWriting(entries, {mode = 'warn', locale = 'auto', sentenceLimits = {}} = {}) {
  if (!['warn', 'strict', 'off'].includes(mode)) throw new TypeError('Writing mode must be warn, strict or off');
  if (mode === 'off') return [];
  const limits = {zh: 50, en: 28, ...sentenceLimits};
  for (const value of Object.values(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new TypeError('Sentence limits must be positive integers');
  }
  const diagnostics = [];
  for (const entry of entries) {
    if (typeof entry.text !== 'string') throw new TypeError('Writing entries require text strings');
    if (entry.component === 'source') continue;
    const original = entry.text;
    const text = proseMask(original);
    const found = [];
    const units = value => (value.match(/\p{Script=Han}/gu)?.length || 0) + (value.match(/[\p{Script=Latin}\d]+(?:[’'_-][\p{Script=Latin}\d]+)*(?:\.\d+)?/gu)?.length || 0);
    if (entry.component === 'scope') {
      if (units(text) > 50) found.push({offset: 0, rule: 'scope-length', units: units(text), limit: 50,
        reason: 'The scope reads as a disclaimer rather than a short label.',
        example: '8 人团队 · 上线半年 · 峰值约 300 QPS / Eight people · six months live · ~300 QPS peak',
        fix: 'Keep the conditions a reader must check, as short labels separated by “·”. Drop process notes about how the page was made.'});
    } else {
      for (const rule of RULES) {
        // New regex per entry prevents mutable lastIndex from leaking between calls.
        for (const match of text.matchAll(new RegExp(rule.pattern.source, rule.pattern.flags))) {
          found.push({offset: match.index, rule: rule.id, reason: rule.reason, example: rule.example, fix: rule.fix, matched: match[0]});
        }
      }
    }
    if (entry.pointer === '/answer/summary' && typeof entry.raw === 'string') {
      const bold = [...entry.raw.matchAll(/\*\*(.+?)\*\*/gu)].reduce((sum, match) => sum + units(match[1]), 0);
      if (units(text) >= 12 && bold / units(text) > .6) found.push({offset: 0, rule: 'verdict-emphasis',
        reason: 'Most of the conclusion is bold, so nothing stands out.',
        example: '先做**模块化单体**，等边界稳定后再拆。 / Keep a **modular monolith** until boundaries settle.',
        fix: 'Bold only the few words that carry the decision.'});
    }
    const sentenceCount = sentences(text).filter(sentence => sentence.text.trim()).length;
    if (entry.component === 'prose' && (units(text) > 120 || sentenceCount > 4)) found.push({offset: 0, rule: 'paragraph-length', units: units(text), limit: 120,
      reason: `This paragraph has ${sentenceCount} sentences and ${units(text)} reading units; long paragraphs are what the page should replace.`,
      example: '把并列要点写成列表，把先后动作写成 @steps，把方案差异写成对比表。 / Turn parallel points into a list, ordered actions into @steps and option differences into a comparison.',
      fix: 'Split the paragraph into a list, steps or a comparison; keep at most two or three short sentences of prose.'});
    if (entry.component !== 'scope') for (const sentence of sentences(text)) {
      const han = sentence.text.match(/\p{Script=Han}/gu)?.length || 0;
      const words = sentence.text.match(/[\p{Script=Latin}\d]+(?:[’'_-][\p{Script=Latin}\d]+)*(?:\.\d+)?/gu)?.length || 0;
      const units = han + words;
      const language = han ? 'zh' : (words ? 'en' : (locale.startsWith('zh') ? 'zh' : 'en'));
      const limit = limits[language];
      if (units > limit) {
        const leading = sentence.text.search(/\S/u);
        found.push({offset: sentence.offset + Math.max(0, leading), rule: 'sentence-length',
          reason: `Sentence has ${units} reading units, above the configured ${language} limit of ${limit}.`,
          example: '先查缓存。未命中时再查数据库。 / Check the cache first. Query the database on a miss.',
          fix: 'Split at a logical action or condition boundary while preserving qualifications and causal links.', units, limit});
      }
    }
    found.sort((a, b) => a.offset - b.offset || a.rule.localeCompare(b.rule, 'en'));
    for (const item of found) {
      diagnostics.push({
        code: `explainer/writing-${item.rule}`, severity: mode === 'strict' ? 'error' : 'warning', message: item.reason,
        subject: {line: (Number.isInteger(entry.line) && entry.line > 0 ? entry.line : 1) + (original.slice(0, item.offset).match(/\n/gu)?.length || 0),
          component: entry.component, ...(entry.panelId === undefined ? {} : {panelId: entry.panelId})},
        evidence: {rule: item.rule, reason: item.reason, example: item.example,
          ...(item.matched ? {matched: item.matched} : {}), ...(item.units ? {units: item.units, limit: item.limit} : {})},
        supportedFixes: [item.fix],
      });
    }
  }
  return diagnostics;
}
