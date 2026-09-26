const PORTABLE_PATH_PROFILES = new Set(['output', 'repo', 'archive']);
const WINDOWS_SAFE_PROFILES = new Set(['output', 'archive']);
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu;
const WINDOWS_SHORT_NAME = /~[1-9][0-9]*(?:\.|$)/iu;
const URI_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/u;
const CONTROL_CHARACTER = /\p{Cc}/u;
const WINDOWS_INVALID_CHARACTER = /[<>"|?*]/u;
const MAX_SEMANTIC_VARIANTS = 32;

export class PortablePathError extends Error {
  constructor(message, {
    code,
    reason,
    value,
    profile,
    segment,
    segmentIndex,
    character,
    index,
    conflictIndex,
    conflictValue,
    collisionKind,
    semantics,
    pathPart,
    conflictPathPart,
    utf8Bytes,
    utf16CodeUnits,
    limit,
  } = {}) {
    super(message);
    this.name = 'PortablePathError';
    this.code = code;
    this.reason = reason;
    this.value = value;
    this.profile = profile;
    if (segment !== undefined) this.segment = segment;
    if (segmentIndex !== undefined) this.segmentIndex = segmentIndex;
    if (character !== undefined) this.character = character;
    if (index !== undefined) this.index = index;
    if (conflictIndex !== undefined) this.conflictIndex = conflictIndex;
    if (conflictValue !== undefined) this.conflictValue = conflictValue;
    if (collisionKind !== undefined) this.collisionKind = collisionKind;
    if (semantics !== undefined) this.semantics = semantics;
    if (pathPart !== undefined) this.pathPart = pathPart;
    if (conflictPathPart !== undefined) this.conflictPathPart = conflictPathPart;
    if (utf8Bytes !== undefined) this.utf8Bytes = utf8Bytes;
    if (utf16CodeUnits !== undefined) this.utf16CodeUnits = utf16CodeUnits;
    if (limit !== undefined) this.limit = limit;
  }
}

function pathError(value, profile, reason, message, details = {}) {
  return new PortablePathError(message, {
    code: `portable-path/${reason}`,
    reason,
    value,
    profile,
    ...details,
  });
}

function assertProfile(profile) {
  if (PORTABLE_PATH_PROFILES.has(profile)) return;
  throw pathError(
    undefined,
    profile,
    'profile',
    `Portable path profile must be one of: ${[...PORTABLE_PATH_PROFILES].join(', ')}.`,
  );
}

export function validatePortablePath(value, options = {}) {
  const profile = options?.profile;
  assertProfile(profile);

  if (typeof value !== 'string') {
    throw pathError(value, profile, 'type', 'Portable path must be a string.');
  }
  if (value.length === 0) {
    throw pathError(value, profile, 'empty', 'Portable path must not be empty.');
  }
  if (/^[A-Za-z]:[\\/]/u.test(value) || value.startsWith('/') || value.startsWith('\\')) {
    throw pathError(value, profile, 'absolute', 'Portable path must be relative.');
  }
  if (/^[A-Za-z]:/u.test(value)) {
    throw pathError(
      value,
      profile,
      'drive-relative',
      'Portable path must not use a drive-relative Windows path.',
    );
  }
  if (URI_SCHEME.test(value)) {
    throw pathError(value, profile, 'uri', 'Portable path must not be a URI.');
  }
  if (value.includes('\\')) {
    throw pathError(
      value,
      profile,
      'backslash',
      'Portable path must use forward slashes as separators.',
    );
  }

  const segments = value.split('/');
  for (const [segmentIndex, segment] of segments.entries()) {
    const segmentDetails = { segment, segmentIndex };
    if (segment.length === 0) {
      throw pathError(
        value,
        profile,
        'empty-segment',
        'Portable path must not contain empty segments.',
        segmentDetails,
      );
    }
    if (segment === '.' || segment === '..') {
      throw pathError(
        value,
        profile,
        'dot-segment',
        'Portable path must not contain dot segments.',
        segmentDetails,
      );
    }
    const controlMatch = segment.match(CONTROL_CHARACTER);
    if (controlMatch) {
      throw pathError(
        value,
        profile,
        'control',
        'Portable path must not contain control characters.',
        { ...segmentDetails, character: controlMatch[0] },
      );
    }
    const surrogateMatch = segment.match(/[\uD800-\uDFFF]/u);
    if (surrogateMatch) {
      throw pathError(
        value,
        profile,
        'unpaired-surrogate',
        'Portable path must not contain unpaired UTF-16 surrogates.',
        { ...segmentDetails, character: surrogateMatch[0] },
      );
    }

    if (!WINDOWS_SAFE_PROFILES.has(profile)) continue;
    if (segment.includes(':')) {
      throw pathError(
        value,
        profile,
        'windows-ads',
        'Portable path must not select a Windows alternate data stream.',
        { ...segmentDetails, character: ':' },
      );
    }
    const invalidMatch = segment.match(WINDOWS_INVALID_CHARACTER);
    if (invalidMatch) {
      throw pathError(
        value,
        profile,
        'windows-invalid-character',
        'Portable path contains a character that is invalid in Windows file names.',
        { ...segmentDetails, character: invalidMatch[0] },
      );
    }
    if (/[. ]$/u.test(segment)) {
      throw pathError(
        value,
        profile,
        'windows-trailing-dot-space',
        'Portable path segments must not end with a dot or space.',
        segmentDetails,
      );
    }
    if (WINDOWS_RESERVED_NAME.test(segment)) {
      throw pathError(
        value,
        profile,
        'windows-reserved-name',
        'Portable path must not use a reserved Windows device name.',
        segmentDetails,
      );
    }
    if (WINDOWS_SHORT_NAME.test(segment)) {
      throw pathError(
        value,
        profile,
        'windows-short-name',
        'Portable path must not use a Windows 8.3 short-name shape.',
        segmentDetails,
      );
    }
    const utf8Bytes = Buffer.byteLength(segment, 'utf8');
    const utf16CodeUnits = segment.length;
    if (utf8Bytes > 255 || utf16CodeUnits > 255) {
      throw pathError(
        value,
        profile,
        'component-too-long',
        'Portable path segments must fit both UTF-8 and UTF-16 filesystem component limits.',
        {
          ...segmentDetails,
          utf8Bytes,
          utf16CodeUnits,
          limit: 255,
        },
      );
    }
  }

  return value;
}

function collisionError(values, profile, index, conflictIndex, reason, details = {}) {
  return new PortablePathError(
    `Portable paths at indexes ${conflictIndex} and ${index} collide under portable filesystem semantics.`,
    {
      code: 'portable-path/collision',
      reason,
      value: values[index],
      profile,
      index,
      conflictIndex,
      conflictValue: values[conflictIndex],
      ...details,
    },
  );
}

function createSemanticIndex() {
  return new Map();
}

function semanticEnvelope(value, profile, index) {
  const variants = [value];
  const seen = new Set(variants);
  const transforms = [
    (candidate) => candidate.normalize('NFC'),
    (candidate) => candidate.normalize('NFD'),
    // path-contract-allow: portable-logical-path -- Archive names require conservative case-collision closure.
    (candidate) => candidate.toLocaleLowerCase('en-US'),
    // path-contract-allow: portable-logical-path -- Archive names require conservative case-collision closure.
    (candidate) => candidate.toLocaleUpperCase('en-US'),
  ];

  for (let cursor = 0; cursor < variants.length; cursor += 1) {
    for (const transform of transforms) {
      const transformed = transform(variants[cursor]);
      if (seen.has(transformed)) continue;
      if (variants.length >= MAX_SEMANTIC_VARIANTS) {
        throw pathError(
          value,
          profile,
          'semantic-expansion',
          'Portable path semantic comparison exceeded its bounded Unicode expansion.',
          { index, limit: MAX_SEMANTIC_VARIANTS },
        );
      }
      seen.add(transformed);
      variants.push(transformed);
    }
  }

  return variants;
}

function classifySemanticCollision(value, conflictValue) {
  if (value === conflictValue) return 'exact';
  if (value.normalize('NFC') === conflictValue.normalize('NFC')) return 'normalization';

  const directLowerMatch = value.toLocaleLowerCase('en-US')
    === conflictValue.toLocaleLowerCase('en-US');
  const directUpperMatch = value.toLocaleUpperCase('en-US')
    === conflictValue.toLocaleUpperCase('en-US');
  return directLowerMatch || directUpperMatch ? 'case' : 'case-and-normalization';
}

function findSemanticCollision(semanticIndex, value, profile, sourceIndex) {
  const variants = semanticEnvelope(value, profile, sourceIndex);
  for (const variant of variants) {
    const entry = semanticIndex.get(variant);
    if (entry) {
      return {
        entry,
        variants,
        semantics: classifySemanticCollision(value, entry.value),
      };
    }
  }
  return { entry: null, variants, semantics: null };
}

function rememberSemanticEntry(semanticIndex, entry, variants) {
  for (const variant of variants) {
    if (!semanticIndex.has(variant)) semanticIndex.set(variant, entry);
  }
}

export function validatePortablePathSet(values, options = {}) {
  const profile = options?.profile;
  assertProfile(profile);
  if (!Array.isArray(values)) {
    throw pathError(values, profile, 'set-type', 'Portable path set must be an array.');
  }

  const leafEntries = createSemanticIndex();
  const directoryEntries = createSemanticIndex();

  for (const [index, value] of values.entries()) {
    try {
      validatePortablePath(value, { profile });
    } catch (error) {
      if (error instanceof PortablePathError && error.index === undefined) error.index = index;
      throw error;
    }

    const leafCollision = findSemanticCollision(leafEntries, value, profile, index);
    if (leafCollision.entry) {
      const conflictIndex = leafCollision.entry.index;
      throw collisionError(
        values,
        profile,
        index,
        conflictIndex,
        leafCollision.semantics === 'exact' ? 'duplicate' : leafCollision.semantics,
        {
          collisionKind: 'entry',
          semantics: leafCollision.semantics,
          pathPart: value,
          conflictPathPart: leafCollision.entry.value,
        },
      );
    }

    const segments = value.split('/');
    const prefixes = segments.slice(0, -1).map((_, prefixIndex) => (
      segments.slice(0, prefixIndex + 1).join('/')
    ));
    for (const prefix of prefixes) {
      const directoryCollision = findSemanticCollision(directoryEntries, prefix, profile, index);
      if (directoryCollision.entry && directoryCollision.semantics !== 'exact') {
        throw collisionError(
          values,
          profile,
          index,
          directoryCollision.entry.index,
          `directory-${directoryCollision.semantics}`,
          {
            collisionKind: 'directory-spelling',
            semantics: directoryCollision.semantics,
            pathPart: prefix,
            conflictPathPart: directoryCollision.entry.value,
          },
        );
      }

      const fileCollision = findSemanticCollision(leafEntries, prefix, profile, index);
      if (fileCollision.entry) {
        throw collisionError(
          values,
          profile,
          index,
          fileCollision.entry.index,
          fileCollision.semantics === 'exact'
            ? 'tree-file'
            : `tree-file-${fileCollision.semantics}`,
          {
            collisionKind: 'tree-file',
            semantics: fileCollision.semantics,
            pathPart: prefix,
            conflictPathPart: fileCollision.entry.value,
          },
        );
      }
    }

    const directoryCollision = findSemanticCollision(directoryEntries, value, profile, index);
    if (directoryCollision.entry) {
      throw collisionError(
        values,
        profile,
        index,
        directoryCollision.entry.index,
        directoryCollision.semantics === 'exact'
          ? 'tree-file'
          : `tree-file-${directoryCollision.semantics}`,
        {
          collisionKind: 'tree-file',
          semantics: directoryCollision.semantics,
          pathPart: value,
          conflictPathPart: directoryCollision.entry.value,
        },
      );
    }

    rememberSemanticEntry(leafEntries, { index, value }, leafCollision.variants);
    for (const prefix of prefixes) {
      rememberSemanticEntry(
        directoryEntries,
        { index, value: prefix },
        semanticEnvelope(prefix, profile, index),
      );
    }
  }

  return values;
}
