import * as tsAdapter from './ts/index.mjs';
import * as pyAdapter from './py/index.mjs';
import * as javaAdapter from './java/index.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fail } from './shared/diagnostics.mjs';
import { JAVA_BUILD_MARKERS } from './shared/files.mjs';

const ADAPTERS = [tsAdapter, pyAdapter, javaAdapter];

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
    supportedFixes: ['point at a directory containing JS/TS, Python or Java sources', 'pass --language explicitly'],
  });
  // A JS/TS or Python tree that also holds Java sources (an Android folder,
  // a build helper) keeps the language it was analyzed in before Java
  // support; the left-out Java files are reported like any other language's.
  // A Maven/Gradle build or Gradle settings file at the root marks a Java
  // project, so a stray script there does not silently replace the Java
  // analysis.
  const javaProject = [...JAVA_BUILD_MARKERS, 'settings.gradle', 'settings.gradle.kts'].some((name) => fs.existsSync(path.join(root, name)));
  const detected = matched.length > 1 && !javaProject ? matched.filter((a) => a !== javaAdapter) : matched;
  if (detected.length > 1) fail('extract/adapter-ambiguous', 'More than one language adapter matches; choose one explicitly.', {
    subject: { root }, evidence: { detected: detected.map((a) => a.id) },
    supportedFixes: detected.map((a) => `pass --language ${a.id}`).concat(['exclude the other language in the config']),
  });
  return detected[0];
}

// One analysis reads one language. When another adapter's sources are also
// present (when the language was chosen explicitly, or Java sources sit
// beside JS/TS or Python), say how
// many files were left out so a clean result is not read as covering them.
export function otherLanguageFiles(root, config, selectedId) {
  return ADAPTERS.filter((a) => a.id !== selectedId)
    .map((a) => ({ adapter: a.id, files: a.countSources(root, config) }))
    .filter((x) => x.files > 0);
}
