const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u;
const CHINESE_EXPLANATION_PREFIX = /^(?:说明|备注|描述|注释|提示|详情|内容)\s*[:：]\s*/u;

const AUTHORED_LANGUAGE_COLLECTIONS = Object.freeze({
  architecture: Object.freeze([
    ['components', ['label', 'sublabel', 'tag']],
    ['boundaries', ['label']],
    ['connections', ['label']],
  ]),
  workflow: Object.freeze([
    ['lanes', ['label']],
    ['phases', ['label']],
    ['groups', ['label']],
    ['nodes', ['label', 'sublabel', 'tag']],
    ['edges', ['label']],
  ]),
  sequence: Object.freeze([
    ['participants', ['label', 'sublabel']],
    ['segments', ['label']],
    ['messages', ['label', 'note']],
  ]),
  dataflow: Object.freeze([
    ['stages', ['label']],
    ['nodes', ['label', 'sublabel', 'tag']],
    ['flows', ['label', 'classification']],
  ]),
  lifecycle: Object.freeze([
    ['lanes', ['label']],
    ['states', ['label', 'sublabel', 'tag']],
    ['transitions', ['label', 'note']],
  ]),
});

function authoredLanguageEntries(diagram) {
  const entries = [];
  const add = (pathValue, value) => {
    if (typeof value !== 'string' || !value.trim()) return;
    entries.push({ path: pathValue, text: value.trim() });
  };
  add('/meta/title', diagram?.meta?.title);
  add('/meta/subtitle', diagram?.meta?.subtitle);
  for (const [index, view] of (diagram?.meta?.views || []).entries()) {
    add(`/meta/views/${index}/label`, view?.label);
    add(`/meta/views/${index}/note`, view?.note);
  }
  for (const [kind, entry] of Object.entries(diagram?.meta?.legend?.entries || {})) {
    add(`/meta/legend/entries/${kind}/label`, entry?.label);
  }
  for (const [index, card] of (diagram?.cards || []).entries()) {
    add(`/cards/${index}/title`, card?.title);
    for (const [itemIndex, item] of (card?.items || []).entries()) {
      add(`/cards/${index}/items/${itemIndex}`, item);
    }
  }
  for (const [collection, fields] of AUTHORED_LANGUAGE_COLLECTIONS[diagram?.diagram_type] || []) {
    for (const [index, item] of (diagram?.[collection] || []).entries()) {
      for (const field of fields) add(`/${collection}/${index}/${field}`, item?.[field]);
    }
  }
  return entries;
}

export function isTechnicalAuthoredText(text) {
  if (typeof text !== 'string' || text.length > 80 || CJK.test(text)) return false;
  const source = text.trim();
  if (!source) return false;
  if (/^(?:CONNECT|DELETE|GET|HEAD|OPTIONS|PATCH|POST|PUT|TRACE)\s+\/[^\s]+$/u.test(source)) {
    return true;
  }
  const identifier = '[A-Za-z_$][A-Za-z0-9_$]*';
  const argument = `${identifier}(?:\\[\\])?`;
  const signature = new RegExp(`^(?:${identifier}\\.)*${identifier}\\(\\s*(?:${argument}(?:\\s*,\\s*${argument})*)?\\s*\\)$`, 'u');
  if (signature.test(source)) return true;

  const safeToken = (token) => /^[A-Za-z0-9][A-Za-z0-9[\]()._/:@{}<>#+-]*$/u.test(token);
  const plainIdentifier = new RegExp(`^${identifier}$`, 'u');
  const technicalSignal = (token) => /[\[\]()._/:@{}<>#+]/u.test(token)
    || /[a-z][A-Z]/u.test(token)
    || /^[A-Z0-9-]{2,}$/u.test(token)
    || /^https?:\/\//iu.test(token);
  const qualifiedIdentifier = new RegExp(`^(?:${identifier}\\.)+${identifier}(?:\\[\\])?$`, 'u');
  const technicalAtom = (token) => qualifiedIdentifier.test(token)
    || new RegExp(`^${identifier}\\[\\]$`, 'u').test(token)
    || (plainIdentifier.test(token) && /[a-z][A-Z]/u.test(token))
    || /^[A-Z0-9-]{2,}$/u.test(token)
    || /^[A-Za-z][A-Za-z0-9]*(?:\+\+|#)$/u.test(token)
    || /^https?:\/\/[^\s]+$/iu.test(token);
  const operatorExpression = source.split(/\s+(?:\+|\/|\||→|->)\s+/u);
  if (operatorExpression.length > 1) {
    return operatorExpression.length <= 5
      && operatorExpression.every((token) => safeToken(token) && technicalAtom(token));
  }

  const tokens = source.split(/\s+/u);
  if (tokens.length === 0 || tokens.length > 2) return false;
  if (!tokens.every(safeToken) || !technicalSignal(tokens[0])) return false;
  return tokens.slice(1).every((token) => (
    technicalSignal(token) || /^[A-Z][A-Za-z0-9+.#/-]*$/u.test(token)
  ));
}

function usesChineseReaderFacingProse(text) {
  const cjkCount = [...text].filter((character) => CJK.test(character)).length;
  if (cjkCount === 0) return isTechnicalAuthoredText(text);
  // A lone generic character such as "图" must not make an otherwise English
  // sentence satisfy the Chinese-language contract.
  if (cjkCount < 2) return false;
  const nonTechnicalEnglishTokens = text
    .replace(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/gu, ' ')
    .split(/\s+/u)
    .map((token) => token
      .replace(/^[^\p{L}\p{N}/_$@.#+:<>{}-]+/gu, '')
      .replace(/[^\p{L}\p{N}/_$@.#+:<>{}-]+$/gu, ''))
    .filter((token) => /[A-Za-z]/u.test(token))
    .filter((token) => !token.startsWith('/') && !isTechnicalAuthoredText(token));
  return nonTechnicalEnglishTokens.length <= 1;
}

function isPreservedTechnicalText(text) {
  if (isTechnicalAuthoredText(text)) return true;
  const withoutExplanationPrefix = text.replace(CHINESE_EXPLANATION_PREFIX, '');
  return withoutExplanationPrefix !== text
    && isTechnicalAuthoredText(withoutExplanationPrefix);
}

export function authoredLanguageAssessment(diagram, requiredLanguage) {
  if (!requiredLanguage) return { diagnostics: [], receipt: null };
  if (!['en', 'zh-CN'].includes(requiredLanguage)) {
    throw new TypeError('requiredLanguage must be en or zh-CN.');
  }
  const locale = diagram?.meta?.locale;
  const entries = authoredLanguageEntries(diagram);
  const title = entries.find((entry) => entry.path === '/meta/title')?.text || '';
  const hasCjk = CJK.test(title);
  const hasLatin = /[A-Za-z]/u.test(title);
  const localeMatches = locale === requiredLanguage;
  const titleMatches = requiredLanguage === 'zh-CN' ? hasCjk : hasLatin && !hasCjk;
  const technicalIdentifiers = entries.filter((entry) => isPreservedTechnicalText(entry.text));
  const proseEntries = entries.filter((entry) => !isPreservedTechnicalText(entry.text));
  const proseViolations = requiredLanguage === 'zh-CN'
    ? proseEntries.filter((entry) => {
      const withoutExplanationPrefix = entry.text.replace(CHINESE_EXPLANATION_PREFIX, '');
      return !usesChineseReaderFacingProse(withoutExplanationPrefix);
    })
    : proseEntries.filter((entry) => CJK.test(entry.text));
  const proseLanguage = requiredLanguage === 'zh-CN' ? 'Simplified Chinese' : 'English';
  const violations = [
    ...(!localeMatches ? [{ path: '/meta/locale', text: locale ?? null, reason: `must equal ${requiredLanguage}` }] : []),
    ...(!titleMatches ? [{ path: '/meta/title', text: title, reason: `must visibly use ${requiredLanguage}` }] : []),
    ...proseViolations.map((entry) => ({ ...entry, reason: `reader-facing prose does not use ${proseLanguage}` })),
  ];
  const receipt = {
    required: requiredLanguage,
    locale: locale ?? null,
    inspected: entries.length,
    proseInspected: proseEntries.length,
    technicalIdentifiersPreserved: technicalIdentifiers.length,
    violations: violations.length,
  };
  if (violations.length === 0) return { diagnostics: [], receipt };
  const problems = [
    ...(!localeMatches ? [`meta.locale must be "${requiredLanguage}"`] : []),
    ...(!titleMatches ? [`meta.title must visibly use ${requiredLanguage === 'zh-CN' ? 'Simplified Chinese' : 'English'}`] : []),
    ...(proseViolations.length ? [`${proseViolations.length} reader-facing prose field(s) must use ${proseLanguage}`] : []),
  ];
  return {
    receipt,
    diagnostics: [{
      code: 'content/authored-language',
      severity: 'error',
      message: `Authored language gate failed: ${problems.join('; ')}.`,
      subject: { path: '/', requiredLanguage },
      evidence: { ...receipt, title, violations },
      supportedFixes: [
        `set meta.locale to "${requiredLanguage}"`,
        `author every reader-facing title, node, relationship, lane, group, guided view, legend override, and card in ${requiredLanguage === 'zh-CN' ? 'Simplified Chinese' : 'English'} while preserving exact product and code identifiers`,
      ],
    }],
  };
}
