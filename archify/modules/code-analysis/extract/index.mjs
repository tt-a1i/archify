import * as tsAdapter from './ts/index.mjs';
import * as pyAdapter from './py/index.mjs';
import * as javaAdapter from './java/index.mjs';
import * as goAdapter from './go/index.mjs';
import * as rustAdapter from './rust/index.mjs';
import * as cAdapter from './c/index.mjs';
import * as cppAdapter from './cpp/index.mjs';
import * as kotlinAdapter from './kotlin/index.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fail } from './shared/diagnostics.mjs';
import { JAVA_BUILD_MARKERS } from './shared/files.mjs';

const ADAPTERS = [tsAdapter, pyAdapter, javaAdapter, kotlinAdapter, goAdapter, rustAdapter, cAdapter, cppAdapter];

export function selectAdapter(root, config, requested) {
  const supported = ADAPTERS.map((a) => a.id);
  if (requested) {
    const adapter = ADAPTERS.find((a) => a.id === requested);
    if (!adapter) fail('extract/adapter-unknown', `No language adapter named "${requested}".`, {
      subject: { option: '--language' }, evidence: { requested, supported },
      supportedFixes: ['choose one of the supported adapters'],
    });
    return adapter;
  }
  const matched = ADAPTERS.filter((a) => a.detect(root, config));
  if (!matched.length) fail('extract/adapter-undetected', 'No language adapter matched the analyzed directory.', {
    subject: { root }, evidence: { supported },
    supportedFixes: ['point at a directory containing supported source files', 'pass --language explicitly'],
  });
  // A JS/TS or Python tree that also holds Java sources (an Android folder,
  // a build helper) keeps the language it was analyzed in before Java
  // support; the left-out Java files are reported like any other language's.
  // A root Maven/Gradle build or Gradle settings file keeps Java eligible.
  const javaProject = [...JAVA_BUILD_MARKERS, 'settings.gradle', 'settings.gradle.kts'].some((name) => fs.existsSync(path.join(root, name)));
  // A JS/TS or Python tree that also holds Kotlin sources (an Android folder,
  // a build helper) keeps the language it was analyzed in before Kotlin
  // support; the left-out Kotlin files are reported like any other language's.
  // A root Maven/Gradle build keeps Java and Kotlin eligible.
  // The markerless preference drops the JVM adapters only when a non-JVM
  // language remains; a directory holding only Java and Kotlin sources keeps
  // both and reaches the dominance/ambiguity checks like any other mix.
  const nonJvm = matched.filter((a) => a !== javaAdapter && a !== kotlinAdapter);
  const withoutJava = matched.length > 1 && !javaProject && nonJvm.length ? nonJvm : matched;
  // A C++ translation-unit selection also covers C translation units from the
  // same compilation database; a mixed C/C++ project is one adapter choice.
  const detected = withoutJava.includes(cppAdapter) ? withoutJava.filter((a) => a !== cAdapter) : withoutJava;
  if (detected.length > 1) {
    const cFiles = matched.includes(cAdapter) && detected.includes(cppAdapter) ? cAdapter.countSources(root, config) : 0;
    const counts = detected
      .map((a) => ({ adapter: a.id, files: a.countSources(root, config) + (a === cppAdapter ? cFiles : 0) }))
      .sort((a, b) => b.files - a.files || (a.adapter < b.adapter ? -1 : 1));
    const total = counts.reduce((sum, count) => sum + count.files, 0);
    const leading = counts[0];
    // Require at least 90% of matched sources. C/C++ needs build membership.
    if (total > 0 && leading.files * 100 >= total * 90 && leading.adapter !== 'c' && leading.adapter !== 'cpp') {
      const adapter = detected.find((a) => a.id === leading.adapter);
      const manifest = adapter.REQUIRED_ROOT_MANIFEST;
      // Match the captured inventory's exact filename and regular-file check.
      if (!manifest || fs.readdirSync(root, { withFileTypes: true }).some(entry => entry.name === manifest && entry.isFile())) return adapter;
    }
    const summary = counts.map((c) => `${c.adapter}: ${c.files} file${c.files === 1 ? '' : 's'}`).join(', ');
    fail('extract/adapter-ambiguous', `More than one language adapter matches (${summary}); choose one explicitly.`, {
      subject: { root },
      evidence: { detected: detected.map((a) => a.id), counts },
      supportedFixes: counts.map((c) => `pass --language ${c.adapter} (${c.files} file${c.files === 1 ? '' : 's'})`),
    });
  }
  return detected[0];
}

// Report source counts for languages outside the selected adapter's coverage.
export function otherLanguageFiles(root, config, selectedId) {
  return ADAPTERS.filter((a) => a.id !== selectedId && !(selectedId === 'cpp' && a.id === 'c'))
    .map((a) => ({ adapter: a.id, files: a.countSources(root, config) }))
    .filter((x) => x.files > 0);
}
