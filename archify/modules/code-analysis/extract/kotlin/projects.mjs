// Gradle build scope for Kotlin source sets. Gradle builds are executable
// Kotlin/Groovy DSL and are never evaluated; this scope models only the
// conventional source-set visibility that is declaratively knowable:
//   - src/main/kotlin and src/main/java form the module's main source set
//   - src/test/kotlin and src/test/java form its test source set
//   - main source cannot bind declarations found only in test source;
//     test source can still see main source
//   - build modules are bounded by build.gradle(.kts)/pom.xml markers
// Gradle dependency evidence is honestly unmodeled in v1, exactly the Java
// adapter's treatment of Gradle builds.
import path from 'node:path';
import { JAVA_BUILD_MARKERS } from '../shared/files.mjs';

const KOTLIN_MARKERS = ['build.gradle.kts', 'settings.gradle.kts'];

export function projectScope(metadataContents, packageMarkers) {
  const markers = packageMarkers.filter(file => [...JAVA_BUILD_MARKERS, 'build.gradle.kts'].includes(path.posix.basename(file)));
  const roots = markers.map(file => ({ file, root: path.posix.dirname(file) === '.' ? '' : path.posix.dirname(file) + '/' }))
    .sort((a, b) => b.root.length - a.root.length || a.file.localeCompare(b.file));
  const owner = file => roots.find(entry => file.startsWith(entry.root));

  function sourceSet(file, root) {
    const relative = file.slice(root.length);
    return relative.startsWith('src/main/kotlin/') || relative.startsWith('src/main/java/') ? 'main'
      : relative.startsWith('src/test/kotlin/') || relative.startsWith('src/test/java/') ? 'test' : null;
  }

  function sourceSetVisible(caller, targetFile) {
    const from = owner(caller), to = owner(targetFile);
    return !from || from.root !== to?.root || sourceSet(caller, from.root) !== 'main' || sourceSet(targetFile, to.root) !== 'test';
  }

  const problems = [];
  for (const marker of markers) {
    if (path.posix.basename(marker) !== 'pom.xml') problems.push({ file: marker, reason: 'unmodeled-gradle-build' });
  }

  return {
    sourceSetVisible,
    evidence: () => null,
    scope: {
      language: 'kotlin',
      build: { model: 'kotlin-source-sets-v1' },
      metadata: [],
      projects: [],
      unknowns: problems,
      limitations: [
        'Gradle builds are executable DSL and are not evaluated. Dependency edges come from source-level type resolution only; no build classpath, plugin-generated source or dependency constraint is modeled.',
        'Only conventional Gradle source-set visibility is modeled: main cannot see test declarations, test can see main. Files outside src/main|test/kotlin|java roots have no source-set identity.',
        'Mixed Kotlin/Java projects are analyzed one language at a time; cross-language references resolve only inside the selected language.',
      ],
    },
  };
}
