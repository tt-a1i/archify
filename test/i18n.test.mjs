import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateSchema } from '../archify/renderers/shared/validator.mjs';
import {
  skillRoot, ES_TRANSLATIONS, KO_TRANSLATIONS, FR_PARTIAL_TRANSLATIONS,
  MANIFEST, EXAMPLES, example, authoredExample, localeDocument, createLocaleFixture,
} from './helpers/i18n-fixture.mjs';

import {
  SUPPORTED_LOCALES,
  bundledLocaleFor,
  catalogKeys,
  resolveCatalog,
  resolveLocale,
  viewerCatalog,
  localizeTemplate,
  translateCount,
  translateMessage,
  registerLocale,
  validateTranslations,
} from '../archify/renderers/shared/i18n.mjs';

const templatePath = path.join(skillRoot, 'assets/template.html');
const { tmp, run, deliverKoreanFixture, deliverJapaneseFixture, cliJson } = createLocaleFixture();

test('zh-CN localizes renderer-owned output across all five modes without translating authored content', () => {
  assert.deepEqual(SUPPORTED_LOCALES, ['en', 'zh-CN', 'zh-TW', 'es', 'ko']);
  for (const type of Object.keys(EXAMPLES)) {
    const document = example(type);
    const authoredTitle = document.meta.title;
    document.meta.locale = 'zh-CN';
    delete document.meta.subtitle;

    const result = run(type, document);
    assert.equal(result.status, 0, `${type}: ${result.stderr || result.stdout}`);
    assert.match(result.html, /^<!DOCTYPE html>\n<html lang="zh-CN"/);
    assert.match(result.html, /<svg\b[^>]*\blang="zh-CN"/);
    assert.ok(result.html.includes(`<title>${authoredTitle}</title>`), `${type}: authored title changed`);
    assert.ok(result.html.includes(`<h1>${authoredTitle}</h1>`), `${type}: authored heading changed`);
    assert.match(result.html, /<text\b[^>]*>\u56fe\u4f8b<\/text>/);
    assert.match(result.html, /aria-label="\u805a\u7126/);
    assert.match(result.html, new RegExp(`<desc id="archify-diagram-description">\u7531 Archify \u751f\u6210\u7684`));
    assert.match(result.html, /"locale":"zh-CN"/);
    assert.match(result.html, />\u5bfc\u51fa\u56fe\u8868</);
    assert.doesNotMatch(result.html, /\{\{i18n:/);
  }
});

test('explicit en, zh-CN, and ko preserve complete authored field inventories across all five modes', () => {
  for (const type of Object.keys(EXAMPLES)) {
    const english = authoredExample(type, 'en');
    const chinese = authoredExample(type, 'zh-CN');
    const korean = authoredExample(type, 'ko');
    assert.equal(english.authored.length, chinese.authored.length, `${type}: authored shapes differ`);
    assert.equal(english.authored.length, korean.authored.length, `${type}: Korean authored shapes differ`);
    assert.ok(english.authored.length >= 10, `${type}: authored inventory is unexpectedly small`);
    if (type === 'dataflow') {
      assert.ok(
        english.authored.includes(english.document.flows[0].classification),
        'dataflow: classification is missing from the authored inventory',
      );
    }
    if (type === 'lifecycle') {
      assert.ok(
        english.authored.includes(english.document.states[0].step),
        'lifecycle: step is missing from the authored inventory',
      );
    }

    for (const candidate of [english, chinese, korean]) {
      const locale = candidate.document.meta.locale;
      const result = run(type, candidate.document);
      assert.equal(result.status, 0, `${type}/${locale}: ${result.stderr || result.stdout}`);
      assert.match(result.html, new RegExp(`^<!DOCTYPE html>\\n<html lang="${locale}"`));
      assert.match(result.html, new RegExp(`<svg\\b[^>]*\\blang="${locale}"`));
      assert.match(result.html, new RegExp(`"locale":"${locale}"`));
      for (const authoredText of candidate.authored) {
        assert.ok(result.html.includes(authoredText), `${type}/${locale}: lost authored text ${authoredText}`);
      }
      if (locale === 'zh-CN') {
        assert.ok(result.html.includes(`<title>${candidate.document.meta.title}</title>`), type);
        assert.match(result.html, />导出图表</);
      } else if (locale === 'ko') {
        assert.ok(result.html.includes(`<title>${candidate.document.meta.title} 다이어그램</title>`), type);
        assert.match(result.html, />다이어그램 내보내기</);
      } else {
        assert.ok(result.html.includes(`<title>${candidate.document.meta.title} Diagram</title>`), type);
        assert.match(result.html, />Export diagram</);
      }
    }
  }
});

test('omitted locale preserves non-English authored content and the English Viewer contract in all five modes', () => {
  for (const type of Object.keys(EXAMPLES)) {
    const document = example(type);
    const authoredTitle = `作者内容-${type}`;
    document.meta.title = authoredTitle;
    delete document.meta.locale;
    delete document.meta.subtitle;

    const result = run(type, document);
    assert.equal(result.status, 0, `${type}: ${result.stderr || result.stdout}`);
    assert.match(result.html, /^<!DOCTYPE html>\n<html lang="en"/);
    assert.ok(result.html.includes(`<title>${authoredTitle} Diagram</title>`), `${type}: authored title changed`);
    assert.ok(result.html.includes(`<h1>${authoredTitle}</h1>`), `${type}: authored heading changed`);
    assert.match(result.html, /<svg\b[^>]*\blang="en"/);
    assert.match(result.html, /aria-label="Focus /);
    assert.match(result.html, /"locale":"en"/);
    assert.match(result.html, />Export diagram</);
  }
});

test('checked-in Korean fixture validates and delivers a ko architecture artifact', () => {
  const { artifact, delivery } = deliverKoreanFixture();
  const html = fs.readFileSync(artifact, 'utf8');
  assert.match(html, /^<!DOCTYPE html>\n<html lang="ko"/);
  assert.match(html, /<svg\b[^>]*\blang="ko"/);
  assert.ok(html.includes('<title>한국어 웹앱 다이어그램</title>'));
  assert.ok(html.includes('<h1>한국어 웹앱</h1>'));
  assert.ok(html.includes('사용자'));
  assert.ok(html.includes('API 서버'));
  assert.match(html, />다이어그램 내보내기</);
  assert.match(html, /<text\b[^>]*>범례<\/text>/);
  assert.match(delivery.artifact.sha256, /^[a-f0-9]{64}$/);
});

// examples/locales/ko.json proved the mechanism for renderer-owned Viewer
// chrome; this fixture proves the other half of "complete" language support
// that predates this PR (issue #458: "the renderer never translates
// authored content") — an agent authoring titles, node labels, and cards
// directly in the target language, with meta.locale/meta.translations
// localizing only the fixed chrome around it. Japanese is a second,
// independent worked example of that same end-to-end pattern.
test('checked-in Japanese fixture validates and delivers a fully-authored ja architecture artifact', () => {
  const { artifact, delivery } = deliverJapaneseFixture();
  const html = fs.readFileSync(artifact, 'utf8');
  assert.match(html, /^<!DOCTYPE html>\n<html lang="ja"/);
  assert.match(html, /<svg\b[^>]*\blang="ja"/);
  assert.ok(html.includes('<title>日本語ウェブアプリ ダイアグラム</title>'));
  assert.ok(html.includes('<h1>日本語ウェブアプリ</h1>'));
  // Authored content (node labels, cards) — never translated, only ever
  // whatever language the fixture itself was written in.
  assert.ok(html.includes('ユーザー'));
  assert.ok(html.includes('APIサーバー'));
  assert.ok(html.includes('エッジ'));
  assert.ok(html.includes('CloudFront CDNがトラフィックを受信'));
  // Renderer-owned chrome — localized via meta.translations.
  assert.match(html, />ダイアグラムをエクスポート</);
  assert.match(html, /<text\b[^>]*>凡例<\/text>/);
  assert.match(delivery.artifact.sha256, /^[a-f0-9]{64}$/);
});

test('malformed locale tags fail schema validation in every mode', () => {
  const invalidLocales = ['123', 'x', 'en_US', 'a'.repeat(40)];
  for (const [index, type] of Object.keys(EXAMPLES).entries()) {
    for (const locale of invalidLocales) {
      const document = localeDocument(type, { locale });
      // The shared validator owns the complete tag matrix. Every type still
      // exercises the public CLI's structured rejection below.
      assert.throws(() => validateSchema(type, document), (error) => {
        assert.ok(error.archifyDiagnostics.some((entry) => entry.subject?.path === '/meta/locale'), `${type}: ${locale}`);
        return true;
      });
    }
    const locale = invalidLocales[index % invalidLocales.length];
    const result = run(type, localeDocument(type, { locale }), 'validate');
    assert.notEqual(result.status, 0, `${type}: malformed locale ${locale} unexpectedly passed`);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, false);
    assert.ok(payload.diagnostics.some((entry) => entry.subject?.path === '/meta/locale'), `${type}: ${locale}`);
  }
});

test('a well-formed but unregistered locale passes validation, falls back to English chrome, and discloses the fallback', () => {
  // Region and script variants are distinct tags: none collapses onto a
  // bundled catalog without explicit data.
  for (const locale of ['fr', 'zh-HK', 'zh-Hant', 'es-MX', 'ko-KR']) {
    // Locale resolution and diagnostics are shared through loadDiagram.
    // Check every tag through architecture, and every renderer with fr;
    // repeating the cross-product does not exercise another fallback path.
    const types = locale === 'fr' ? Object.keys(EXAMPLES) : ['architecture'];
    for (const type of types) {
      const document = example(type);
      document.meta.locale = locale;
      const validated = run(type, document, 'validate');
      assert.equal(validated.status, 0, `${type}/${locale}: ${validated.stderr || validated.stdout}`);
      assert.equal(JSON.parse(validated.stdout).ok, true, `${type}/${locale}`);
      assert.match(
        validated.stderr,
        new RegExp(`meta\\.locale "${locale}" has no bundled catalog and no usable meta\\.translations`),
        `${type}/${locale}: fallback was not disclosed`,
      );

      const rendered = run(type, document);
      assert.equal(rendered.status, 0, `${type}/${locale}: ${rendered.stderr || rendered.stdout}`);
      assert.match(rendered.html, /^<!DOCTYPE html>\n<html lang="en"/, `${type}/${locale}: did not fall back to en`);
      assert.match(rendered.html, />Export diagram</, `${type}/${locale}`);
    }
  }
});

test('a previously unsupported locale localizes renderer-owned output once meta.translations supplies it, with partial coverage falling back to English key by key', () => {
  const report = validateTranslations(FR_PARTIAL_TRANSLATIONS);
  assert.ok(report.coveredKeys > 0 && report.coveredKeys < report.totalKeys, 'fixture should demonstrate partial, not full or empty, coverage');
  assert.deepEqual(report.placeholderMismatches, []);

  for (const type of Object.keys(EXAMPLES)) {
    const document = example(type);
    document.meta.locale = 'fr';
    document.meta.translations = FR_PARTIAL_TRANSLATIONS;
    delete document.meta.subtitle;

    const result = run(type, document);
    assert.equal(result.status, 0, `${type}: ${result.stderr || result.stdout}`);
    assert.match(result.html, /^<!DOCTYPE html>\n<html lang="fr"/, type);
    assert.match(result.html, /<svg\b[^>]*\blang="fr"/, type);
    assert.match(result.html, /<text\b[^>]*>Légende<\/text>/, `${type}: covered key did not localize`);
    assert.match(result.html, />Exporter le diagramme</, `${type}: covered key did not localize`);
    // A missing outline label falls back to the canonical English message.
    assert.match(result.html, />Node index</, `${type}: uncovered key did not fall back to English`);
    assert.match(
      result.stderr,
      new RegExp(`meta\\.locale "fr" resolves ${report.coveredKeys}/${report.totalKeys} renderer-owned messages \\(\\d+%\\) from ${report.coveredKeys} meta\\.translations entries; ${report.totalKeys - report.coveredKeys} fall back to English`),
      `${type}: coverage was not disclosed`,
    );
  }
});

test('translations with unknown keys or mismatched interpolation placeholders are reported and fall back to English per key', () => {
  const document = example('architecture');
  document.meta.locale = 'fr';
  document.meta.translations = {
    ...FR_PARTIAL_TRANSLATIONS,
    'node.focus': '{wrongPlaceholder} au point',
    'this.key.does.not.exist': 'orphan',
  };
  delete document.meta.subtitle;

  const result = run('architecture', document);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  // node.focus falls back to English because {wrongPlaceholder} does not
  // match the canonical {label} token — never a raw or broken template.
  assert.match(result.html, /aria-label="Focus /);
  assert.doesNotMatch(result.html, /wrongPlaceholder/);
  assert.match(result.stderr, /meta\.translations for locale "fr" has 2 unusable entries \(1 unknown, 1 placeholder mismatch\); each keeps its English message/);
  assert.match(result.stderr, /meta\.locale "fr" resolves \d+\/\d+ renderer-owned messages/);
});

function embeddedMessages(html) {
  const embedded = html.match(/<script id="archify-i18n-data" type="application\/json">([\s\S]*?)<\/script>/);
  assert.ok(embedded, 'missing embedded i18n data script');
  return JSON.parse(embedded[1]);
}

test('bundled es and ko render from meta.locale alone in all five modes, identical to supplying the full catalog', () => {
  const cases = {
    es: {
      catalog: ES_TRANSLATIONS, legend: 'Leyenda', focus: 'Enfocar', exportLabel: 'Exportar diagrama',
      titleSuffix: ' · Diagrama', description: /<desc id="archify-diagram-description">Un diagrama de /,
    },
    ko: {
      catalog: KO_TRANSLATIONS, legend: '범례', focus: '포커스', exportLabel: '다이어그램 내보내기',
      titleSuffix: ' 다이어그램', description: /<desc id="archify-diagram-description">Archify로 생성한/,
    },
  };
  for (const [locale, expected] of Object.entries(cases)) {
    assert.equal(validateTranslations(expected.catalog).coverage, 1);
    for (const type of Object.keys(EXAMPLES)) {
      const localeOnly = run(type, localeDocument(type, { locale }));
      assert.equal(localeOnly.status, 0, `${type}/${locale}: ${localeOnly.stderr || localeOnly.stdout}`);
      assert.equal(localeOnly.stderr, '', `${type}/${locale}: a complete bundled catalog should not warn`);
      assert.match(localeOnly.html, new RegExp(`^<!DOCTYPE html>\\n<html lang="${locale}"`));
      assert.match(localeOnly.html, new RegExp(`<svg\\b[^>]*\\blang="${locale}"`));
      assert.match(localeOnly.html, new RegExp(`<text\\b[^>]*>${expected.legend}</text>`), `${type}/${locale}: default legend`);
      assert.match(localeOnly.html, new RegExp(`aria-label="[^"]*${expected.focus}`), `${type}/${locale}: accessibility copy`);
      assert.ok(localeOnly.html.includes(`>${expected.exportLabel}<`), `${type}/${locale}: fixed control`);
      const runtime = embeddedMessages(localeOnly.html);
      assert.equal(runtime.locale, locale);
      for (const [key, message] of Object.entries(runtime.messages)) {
        assert.equal(message, expected.catalog[key], `${type}/${locale}: dynamic Viewer message ${key}`);
      }

      const supplied = run(type, localeDocument(type, { locale, translations: expected.catalog }));
      assert.equal(supplied.status, 0, `${type}/${locale}: ${supplied.stderr || supplied.stdout}`);
      assert.equal(supplied.stderr, '', `${type}/${locale}: a complete supplied catalog should not warn`);
      assert.equal(supplied.html, localeOnly.html, `${type}/${locale}: supplied catalog changed existing wording`);
      // These were separate supplied-catalog renders of the same documents.
      // Keep their authored-content and accessible-description assertions here.
      const authoredTitle = example(type).meta.title;
      assert.ok(supplied.html.includes(`<title>${authoredTitle}${expected.titleSuffix}</title>`), `${type}/${locale}: authored title changed`);
      assert.ok(supplied.html.includes(`<h1>${authoredTitle}</h1>`), `${type}/${locale}: authored heading changed`);
      assert.match(supplied.html, expected.description);
      assert.doesNotMatch(supplied.html, /\{\{i18n:/);
    }
  }
});

test('a partial override replaces only its keys and keeps the rest of the selected bundled language', () => {
  const overrides = {
    'zh-CN': { message: '关闭面板', legend: '图例' },
    es: { message: 'Cerrar panel', legend: 'Leyenda' },
    ko: { message: '패널 닫기', legend: '범례' },
  };
  // Every renderer registers its document through the shared CLI and embeds
  // that catalog through applyTemplate. Cover the rule matrix once, then
  // prove each renderer's wiring with a real one-key override.
  for (const [locale, expected] of Object.entries(overrides)) {
    const bundled = resolveCatalog(locale).messages;
    const resolved = resolveCatalog(locale, { 'viewer.common.close': expected.message });
    assert.deepEqual(resolved.messages, { ...bundled, 'viewer.common.close': expected.message });
    assert.equal(resolved.messages['legend.title'], expected.legend);
    assert.deepEqual(resolved.report.fallbackKeys, []);
    assert.equal(resolved.report.override.appliedKeys, 1);
  }
  const locales = Object.keys(overrides);
  for (const [index, type] of Object.keys(EXAMPLES).entries()) {
    const locale = locales[index % locales.length];
    const expected = overrides[locale];
    const result = run(type, localeDocument(type, { locale, translations: { 'viewer.common.close': expected.message } }));
    assert.equal(result.status, 0, `${type}/${locale}: ${result.stderr || result.stdout}`);
    assert.equal(result.stderr, '', `${type}/${locale}: a valid one-key override over a complete catalog is not a coverage gap`);
    assert.match(result.html, new RegExp(`^<!DOCTYPE html>\\n<html lang="${locale}"`));
    assert.match(result.html, new RegExp(`<text\\b[^>]*>${expected.legend}</text>`), `${type}/${locale}: rest of the language was lost`);
    const runtime = embeddedMessages(result.html);
    assert.equal(runtime.messages['viewer.common.close'], expected.message);
    assert.equal(runtime.messages['viewer.common.copyLink'], translateMessage(locale, 'viewer.common.copyLink'));
  }
});

test('empty translations and equivalent tag casing select the same bundled catalog', () => {
  const chinese = resolveCatalog('zh-CN');
  const koreanCatalog = resolveCatalog('ko');
  assert.deepEqual(resolveCatalog('ko', {}).messages, koreanCatalog.messages);
  assert.deepEqual(resolveCatalog('ko', {}).report, koreanCatalog.report);
  const overrides = { 'viewer.common.close': '关闭面板', 'viewer.export.diagram': '导出此图' };
  for (const locale of ['zh-cn', 'zh-cN', 'ZH-cn']) {
    assert.deepEqual(resolveCatalog(locale).messages, chinese.messages);
    assert.equal(resolveCatalog(locale).report.resolvedLocale, 'zh-CN');
    try {
      registerLocale(locale, overrides);
      for (const lookup of [locale, 'zh-CN', 'ZH-cn']) {
        assert.equal(resolveLocale(lookup), 'zh-CN');
        assert.equal(translateMessage(lookup, 'viewer.common.close'), overrides['viewer.common.close']);
        assert.equal(viewerCatalog(lookup)['viewer.common.close'], overrides['viewer.common.close']);
        assert.equal(localizeTemplate('{{i18n:viewer.export.diagram}}', lookup), '导出此图');
      }
    } finally {
      registerLocale(locale);
    }
  }
  for (const [index, type] of Object.keys(EXAMPLES).entries()) {
    const reference = run(type, localeDocument(type, { locale: 'zh-CN' }));
    assert.equal(reference.status, 0, reference.stderr);
    const lowered = run(type, localeDocument(type, { locale: 'zh-cn' }));
    assert.equal(lowered.status, 0, lowered.stderr);
    assert.equal(lowered.stderr, '');
    assert.equal(lowered.html, reference.html, `${type}: zh-cn should select the zh-CN catalog and canonical lang`);

    // The shared empty-override rule also has a real renderer witness.
    if (type === 'architecture') {
      const korean = run(type, localeDocument(type, { locale: 'ko' }));
      const empty = run(type, localeDocument(type, { locale: 'ko', translations: {} }));
      assert.equal(korean.status, 0, korean.stderr);
      assert.equal(empty.status, 0, empty.stderr);
      assert.equal(empty.stderr, '');
      assert.equal(empty.html, korean.html, '{} is not an override');
    }
    const locale = index % 2 ? 'zh-cN' : 'zh-cn';
    const result = run(type, localeDocument(type, { locale, translations: overrides }));
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.match(result.html, /^<!DOCTYPE html>\n<html lang="zh-CN"/);
    const runtime = embeddedMessages(result.html);
    assert.equal(runtime.locale, 'zh-CN');
    assert.equal(runtime.messages['viewer.common.close'], '关闭面板', `${type}/${locale}: embedded Viewer override lost`);
    assert.ok(result.html.includes('>导出此图<'), `${type}/${locale}: template override lost`);
  }
  assert.equal(bundledLocaleFor('ZH-cn'), 'zh-CN');
  assert.equal(bundledLocaleFor('zh-Hant'), null);
  assert.equal(bundledLocaleFor('zh'), null);
});

test('rejected overrides keep the bundled message and are reported apart from English fallback gaps', () => {
  const result = run('architecture', localeDocument('architecture', {
    locale: 'es',
    translations: {
      'viewer.common.close': 'Cerrar {panel}',
      'viewer.common.clear': 'Vaciar',
      'viewer.common.closee': 'Cerrar',
    },
  }));
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const runtime = embeddedMessages(result.html);
  assert.equal(runtime.messages['viewer.common.close'], ES_TRANSLATIONS['viewer.common.close']);
  assert.equal(runtime.messages['viewer.common.clear'], 'Vaciar');
  assert.match(result.stderr, /meta\.translations for locale "es" has 2 unusable entries \(1 unknown, 1 placeholder mismatch\); each keeps its bundled es message\./);
  assert.doesNotMatch(result.stderr, /fall back to English/, 'a rejected override over a complete catalog is not an English gap');

  const { report } = resolveCatalog('es', {
    'viewer.common.close': 'Cerrar {panel}',
    'viewer.common.clear': 'Vaciar',
    'viewer.common.closee': 'Cerrar',
  });
  assert.equal(report.translatedKeys, report.totalKeys);
  assert.deepEqual(report.fallbackKeys, []);
  assert.equal(report.override.appliedKeys, 1);
  assert.deepEqual(report.override.unknownKeys, ['viewer.common.closee']);
  assert.deepEqual(report.override.placeholderMismatches, [{ key: 'viewer.common.close', expected: [], actual: ['panel'] }]);
});

test('an unbundled tag with only unusable translations falls back to English UI and language metadata', () => {
  const result = run('architecture', localeDocument('architecture', {
    locale: 'fr',
    translations: { 'viewer.common.closee': 'Fermer' },
  }));
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.html, /^<!DOCTYPE html>\n<html lang="en"/);
  assert.match(result.stderr, /has 1 unusable entry \(1 unknown, 0 placeholder mismatch\); each keeps its English message/);
  assert.match(result.stderr, /meta\.locale "fr" has no bundled catalog and no usable meta\.translations/);
});

test('coverage reports the final resolved catalog with the English source of each gap', () => {
  const partial = resolveCatalog('fr', FR_PARTIAL_TRANSLATIONS).report;
  assert.equal(partial.resolvedLocale, 'fr');
  assert.equal(partial.bundledLocale, null);
  assert.equal(partial.translatedKeys, Object.keys(FR_PARTIAL_TRANSLATIONS).length);
  assert.equal(partial.translatedKeys + partial.fallbackKeys.length, partial.totalKeys);

  const oneKey = resolveCatalog('ko', { 'viewer.common.close': '패널 닫기' }).report;
  assert.equal(oneKey.translatedKeys, oneKey.totalKeys, 'override size must not be reported as coverage');
  assert.equal(oneKey.override.appliedKeys, 1);

  // A bundled catalog that lags behind a new canonical key reports only that
  // gap; English is never a gap for English.
  const lagging = { ...ES_TRANSLATIONS };
  delete lagging['viewer.common.close'];
  const unbundledSpanish = resolveCatalog('es-419', lagging).report;
  assert.deepEqual(unbundledSpanish.fallbackKeys, ['viewer.common.close']);
  assert.deepEqual(resolveCatalog('en', { 'viewer.common.close': 'Dismiss' }).report.fallbackKeys, []);
  assert.deepEqual(resolveCatalog('en-GB', { 'viewer.common.close': 'Dismiss' }).report.fallbackKeys, []);
});

test('a document override never mutates the reusable bundled catalog', () => {
  const before = translateMessage('es', 'viewer.common.close');
  const { messages } = resolveCatalog('es', { 'viewer.common.close': 'Cerrar panel' });
  assert.equal(messages['viewer.common.close'], 'Cerrar panel');
  assert.ok(Object.isFrozen(messages));
  assert.equal(translateMessage('es', 'viewer.common.close'), before);

  registerLocale('es', { 'viewer.common.close': 'Cerrar panel' });
  assert.equal(translateMessage('es', 'viewer.common.close'), 'Cerrar panel');
  registerLocale('es');
  assert.equal(translateMessage('es', 'viewer.common.close'), before, 'a later document without overrides reuses the bundled catalog');
});

test('validate and deliver receipts carry locale warnings as structured diagnostics without failing', () => {
  const input = path.join(tmp, 'receipt-fr.json');
  fs.writeFileSync(input, JSON.stringify(localeDocument('architecture', {
    locale: 'fr',
    translations: { ...FR_PARTIAL_TRANSLATIONS, 'viewer.common.closee': 'Fermer' },
  })));
  const validated = cliJson(['validate', 'architecture', input, '--json']);
  const delivered = cliJson(['deliver', 'architecture', input, path.join(tmp, 'receipt-fr.html'), '--json']);
  for (const receipt of [validated, delivered]) {
    assert.equal(receipt.ok, true);
    assert.deepEqual(receipt.diagnostics.map((entry) => [entry.code, entry.severity]), [
      ['i18n/invalid-translation', 'warning'],
      ['i18n/translation-coverage', 'warning'],
    ]);
    const coverage = receipt.diagnostics[1].evidence;
    assert.equal(coverage.missingKeysTotal, coverage.totalKeys - coverage.translatedKeys);
    assert.equal(coverage.missingKeys.length, 10);
    for (const key of coverage.missingKeys) assert.equal(coverage.englishSource[key], translateMessage('en', key));
    assert.deepEqual(receipt.diagnostics[0].evidence.unknownKeys, ['viewer.common.closee']);
  }

  const clean = path.join(tmp, 'receipt-ko.json');
  fs.writeFileSync(clean, JSON.stringify(localeDocument('architecture', { locale: 'ko' })));
  assert.equal(cliJson(['validate', 'architecture', clean, '--json']).diagnostics, undefined);
  assert.equal(cliJson(['deliver', 'architecture', clean, path.join(tmp, 'receipt-ko.html'), '--json']).diagnostics, undefined);
});

test('the manifest enrolls exactly the bundled catalogs, and each is complete', () => {
  assert.deepEqual(MANIFEST.catalogs.map(({ locale }) => locale), SUPPORTED_LOCALES);
  const files = fs.readdirSync(path.join(skillRoot, 'locales')).filter((file) => file.endsWith('.json') && file !== 'manifest.json').sort();
  assert.deepEqual(MANIFEST.catalogs.map(({ file }) => file).sort(), files, 'every bundled catalog file is enrolled and every entry exists');
  for (const { locale, file } of MANIFEST.catalogs) {
    const report = validateTranslations(JSON.parse(fs.readFileSync(path.join(skillRoot, 'locales', file), 'utf8')));
    assert.equal(report.coveredKeys, report.totalKeys, `${locale}: missing ${report.missingKeys.join(', ')}`);
    assert.deepEqual(report.unknownKeys, [], locale);
    assert.deepEqual(report.placeholderMismatches, [], locale);
  }
});

test('enrolling a catalog is a data-only change and works from an unrelated working directory', () => {
  // Copy the runtime (no tests, no node_modules) outside the checkout, enroll
  // one more catalog through data alone, and render from an unrelated cwd.
  const packageRoot = path.join(tmp, 'package-copy', 'archify');
  fs.cpSync(skillRoot, packageRoot, {
    recursive: true,
    filter: (source) => !['node_modules', 'test'].includes(path.basename(source)) || path.dirname(source) !== skillRoot,
  });
  const french = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples/locales/fr.json'), 'utf8'));
  fs.writeFileSync(path.join(packageRoot, 'locales/fr.json'), JSON.stringify(french));
  const manifestPath = path.join(packageRoot, 'locales/manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.catalogs.push({ locale: 'fr', file: 'fr.json' });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));

  const unrelated = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-i18n-cwd-'));
  // A decoy catalog in the working directory must never be picked up.
  fs.mkdirSync(path.join(unrelated, 'locales'));
  fs.writeFileSync(path.join(unrelated, 'locales/manifest.json'), '{"catalogs":[]}');
  for (const [locale, legend] of [['fr', 'Légende'], ['ko', '범례']]) {
    const input = path.join(unrelated, `${locale}.json`);
    const output = path.join(unrelated, `${locale}.html`);
    fs.writeFileSync(input, JSON.stringify(localeDocument('architecture', { locale })));
    const result = spawnSync(process.execPath, [path.join(packageRoot, 'bin/archify.mjs'), 'render', 'architecture', input, output], {
      cwd: unrelated,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, `${locale}: ${result.stderr || result.stdout}`);
    const html = fs.readFileSync(output, 'utf8');
    assert.match(html, new RegExp(`^<!DOCTYPE html>\\n<html lang="${locale}"`));
    assert.match(html, new RegExp(`<text\\b[^>]*>${legend}</text>`));
    if (locale === 'fr') assert.match(result.stderr, /meta\.locale "fr" resolves \d+\/\d+ renderer-owned messages \(\d+%\) from the bundled fr catalog; \d+ fall back to English\./);
  }
});

test('every Viewer message reference resolves through the shared catalog', () => {
  const template = fs.readFileSync(templatePath, 'utf8');
  const keys = new Set(catalogKeys());
  const references = new Set([
    ...[...template.matchAll(/\{\{i18n:([a-zA-Z0-9_.-]+)\}\}/g)].map((match) => match[1]),
    ...[...template.matchAll(/['"](viewer\.[a-zA-Z0-9_.-]+)['"]/g)].map((match) => match[1]),
  ]);
  const unresolved = [...references].filter((key) => (
    !key.endsWith('.') && !keys.has(key) && !(keys.has(`${key}.one`) && keys.has(`${key}.other`))
  ));
  assert.deepEqual(unresolved, []);
});

test('every supported catalog is complete and preserves interpolation variables', () => {
  const variables = (value) => [...value.matchAll(/\{([a-zA-Z0-9_]+)\}/g)]
    .map((match) => match[1])
    .sort();
  for (const key of catalogKeys()) {
    const expected = variables(translateMessage('en', key));
    for (const locale of SUPPORTED_LOCALES) {
      const message = translateMessage(locale, key);
      assert.ok(message && message !== 'undefined', `${locale}: ${key}`);
      assert.deepEqual(variables(message), expected, `${locale}: ${key}`);
    }
  }
});

test('the bundled Korean catalog is complete and preserves interpolation variables for every canonical key', () => {
  const report = validateTranslations(KO_TRANSLATIONS);
  assert.equal(report.missingKeys.length, 0, `missing: ${report.missingKeys.join(', ')}`);
  assert.equal(report.unknownKeys.length, 0, `unknown: ${report.unknownKeys.join(', ')}`);
  assert.equal(report.placeholderMismatches.length, 0, JSON.stringify(report.placeholderMismatches));
  assert.equal(report.coveredKeys, report.totalKeys);
});

// Additional checked-in example catalogs demonstrating the same data
// contract across a wider language set (representative real-diagram checks
// requested in tt-a1i's review on #457): reusable catalogs a caller can
// supply via meta.translations. Historical key gaps fall back explicitly;
// newly added diagram types must carry their own translations.
for (const locale of ['fr', 'pt', 'ja', 'de', 'it', 'ru']) {
  test(`the checked-in ${locale} example catalog validates reusable translations and discloses historical gaps`, () => {
    const translations = JSON.parse(fs.readFileSync(path.join(skillRoot, `examples/locales/${locale}.json`), 'utf8'));
    const report = validateTranslations(translations);
    assert.ok(report.coverage > 0.9, 'reuse the established catalog while historical gaps fall back explicitly');
    const newDiagramKeys = catalogKeys().filter((key) =>
      /\.(?:tree|class|timeline|waterfall)(?:\.|$)/.test(key) || /^(?:tree|timeline|waterfall)\./.test(key));
    for (const key of newDiagramKeys) {
      assert.equal(typeof translations[key], 'string', `${locale}: missing ${key}`);
      assert.ok(translations[key].trim(), `${locale}: empty ${key}`);
    }
    assert.equal(report.unknownKeys.length, 0, `unknown: ${report.unknownKeys.join(', ')}`);
    assert.equal(report.placeholderMismatches.length, 0, JSON.stringify(report.placeholderMismatches));
    assert.equal(report.coveredKeys + report.missingKeys.length, report.totalKeys);
  });

  test(`${locale} localizes renderer-owned output via meta.translations without leaving any renderer-owned English badge or preset name behind`, () => {
    const translations = JSON.parse(fs.readFileSync(path.join(skillRoot, `examples/locales/${locale}.json`), 'utf8'));
    const document = example('architecture');
    document.meta.locale = locale;
    document.meta.translations = translations;
    delete document.meta.subtitle;

    const result = run('architecture', document);
    assert.equal(result.status, 0, `${locale}: ${result.stderr || result.stdout}`);
    assert.match(result.html, new RegExp(`^<!DOCTYPE html>\\n<html lang="${locale}"`));
    assert.match(result.html, new RegExp(`"locale":"${locale}"`));
    assert.doesNotMatch(result.html, /\{\{i18n:/);
    assert.doesNotMatch(result.stderr, /has no bundled catalog/, `${locale}: unexpectedly fell back to English`);

    // Check the actual embedded runtime catalog, not raw HTML/CSS source
    // (which can contain incidental English substrings, e.g. template
    // section comments, that are never shown to a reader). These
    // ALL-CAPS badges/short labels must be translated, not silently left
    // in English — see the fr/de/it/ja fix for the bug where several
    // catalogs kept them as English badges by mistake.
    const embedded = result.html.match(/<script id="archify-i18n-data" type="application\/json">([\s\S]*?)<\/script>/);
    assert.ok(embedded, `${locale}: missing embedded i18n data script`);
    const messages = JSON.parse(embedded[1]).messages;
    const englishBadges = {
      'viewer.preset.badge.signalFlow': 'SIGNAL FLOW',
      'viewer.nav.radar.short': 'MAP',
      'viewer.nav.level.map': 'MAP',
      'viewer.nav.lens.short': 'LENS',
      'viewer.nav.route.short': 'ROUTE',
      'viewer.nav.read': 'READ',
      'viewer.nav.level.read': 'READ',
      'viewer.nav.level.full': 'FULL',
    };
    for (const [key, enValue] of Object.entries(englishBadges)) {
      assert.notEqual(messages[key], enValue, `${locale}: ${key} left untranslated as "${enValue}"`);
    }
  });
}

test('runtime labels stay localized after composition', () => {
  assert.equal(translateMessage('zh-CN', 'viewer.kind.backend'), '后端');
  assert.equal(translateMessage('zh-CN', 'viewer.kind.decision'), '决策');
  assert.equal(translateMessage('zh-CN', 'viewer.passport.relationship.connectsFrom'), '连接自');
  assert.equal(translateMessage('zh-CN', 'viewer.nav.level.auto'), '自动');

  const zhHops = translateCount('zh-CN', 'viewer.route.hop', 2);
  assert.equal(
    translateMessage('zh-CN', 'viewer.finder.result.routeTarget', { label: '终点', links: zhHops }),
    '选择终点作为路径终点，2 跳',
  );
  const enHop = translateCount('en', 'viewer.route.overview.hop', 1);
  const enNode = translateCount('en', 'viewer.route.overview.node', 2);
  assert.equal(
    translateMessage('en', 'viewer.route.overview.status', { nodes: enNode, hops: enHop }),
    '2 nodes · 1 step · shortest path',
  );

  assert.equal(translateMessage('ko', 'viewer.kind.backend'), '백엔드');
  assert.equal(translateMessage('ko', 'viewer.kind.decision'), '판단');
  assert.equal(translateMessage('ko', 'viewer.passport.relationship.connectsFrom'), '연결 출처');
  assert.equal(translateMessage('ko', 'viewer.nav.level.auto'), '자동');
  const koHops = translateCount('ko', 'viewer.route.hop', 2);
  assert.equal(
    translateMessage('ko', 'viewer.finder.result.routeTarget', { label: '도착', links: koHops }),
    '도착을(를) 경로 도착점으로 선택, 홉 2개',
  );
});

test('Share Card and export failures use catalog messages instead of fixed English', () => {
  assert.equal(
    translateCount('zh-CN', 'viewer.export.card.routeSummary', 2, { source: '来源', target: '目标' }),
    '路径：来源 → 目标 · 2 步',
  );
  assert.equal(
    translateMessage('zh-CN', 'viewer.export.error.toBlobNull', { label: '分享卡片' }),
    '分享卡片的 canvas.toBlob 未返回数据',
  );
  assert.equal(
    translateCount('ko', 'viewer.export.card.routeSummary', 2, { source: '출발', target: '도착' }),
    '경로: 출발 → 도착 · 방향성 홉 2개',
  );
  assert.equal(
    translateMessage('ko', 'viewer.export.error.toBlobNull', { label: '공유 카드' }),
    '공유 카드의 canvas.toBlob이 데이터를 반환하지 않았습니다',
  );

  const template = fs.readFileSync(templatePath, 'utf8');
  for (const hardcoded of [
    "'Route: '",
    "'Share Card variants cannot be combined'",
    "canvas2dOrThrow(canvas, 'Share Card')",
    "'Share Card export could not remove temporary viewer state'",
    "'WebM motion export requires a trace animation and browser MediaRecorder support'",
  ]) {
    assert.ok(!template.includes(hardcoded), hardcoded);
  }
});
