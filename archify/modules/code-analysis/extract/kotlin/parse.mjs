// Parse only captured source text. No Kotlin compiler, Gradle build or
// analyzed code runs. Tokens keep exact UTF-16 source offsets for evidence.
import { parseKotlinSource, ParseError } from './syntax.mjs';
import { matcher } from '../shared/glob.mjs';
import { classifyRole, lineCount, snapshotFiles, packageMarkersIn, PACKAGE_MARKERS, JAVA_BUILD_MARKERS } from '../shared/files.mjs';

export const PARSER = 'kotlin-source@1';
export const isKotlinSource = file => file.endsWith('.kt');
// Gradle Kotlin DSL build scripts and settings are build metadata, never sources.
const KOTLIN_BUILD_MARKERS = ['build.gradle.kts', 'settings.gradle.kts'];

export function parseSources(root, config, consume = unit => unit) {
  const markers = [...PACKAGE_MARKERS, ...JAVA_BUILD_MARKERS, ...KOTLIN_BUILD_MARKERS];
  const included = matcher(config.include);
  const captured = snapshotFiles(root, { ...config, include: [...(config.include || ['**/*']), '**/*.xml', '**/*.pom', ...markers.map(name => '**/' + name)] },
    file => (included(file) && isKotlinSource(file)) || /\.(?:xml|pom)$/.test(file) || markers.includes(file.slice(file.lastIndexOf('/') + 1)));
  const snapshot = {
    contents: new Map([...captured].filter(([file]) => included(file) && isKotlinSource(file))),
    packageMarkers: packageMarkersIn([...captured.keys()], config, markers)
      .filter(file => !/(^|\/)src\/main\/resources\/archetype-resources\//.test(file)),
  };
  const files = [], units = [], parse_errors = [];
  for (const [file, bytes] of snapshot.contents) {
    let sourceText;
    try {
      sourceText = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      sourceText = bytes.toString('utf8');
      parse_errors.push({ path: file, message: 'Kotlin source must be UTF-8; this file could not be decoded.' });
    }
    files.push({ path: file, sourceText, loc: lineCount(sourceText), role: classifyRole(file, config.roles) });
    if (parse_errors.at(-1)?.path === file) continue;
    let parsed;
    try {
      parsed = parseKotlinSource(sourceText);
    } catch (error) {
      const message = (error instanceof ParseError ? error.message : `unsupported Kotlin syntax: ${error.message}`).slice(0, 600);
      parse_errors.push({ path: file, message });
    }
    // Reduction bugs stay outside the parser catch so they cannot masquerade
    // as bad source syntax.
    if (parsed) units.push(consume({ file, sourceText, ...parsed }));
  }
  return { files, units, packageMarkers: snapshot.packageMarkers, parse_errors, metadataContents: captured };
}
