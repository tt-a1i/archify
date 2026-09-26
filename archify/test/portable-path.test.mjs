import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PortablePathError,
  validatePortablePath,
  validatePortablePathSet,
} from '../renderers/shared/portable-path.mjs';

function assertPathError(run, { code, reason, profile, segment, index, conflictIndex } = {}) {
  assert.throws(run, (error) => {
    assert.ok(error instanceof PortablePathError);
    if (code !== undefined) assert.equal(error.code, code);
    if (reason !== undefined) assert.equal(error.reason, reason);
    if (profile !== undefined) assert.equal(error.profile, profile);
    if (segment !== undefined) assert.equal(error.segment, segment);
    if (index !== undefined) assert.equal(error.index, index);
    if (conflictIndex !== undefined) assert.equal(error.conflictIndex, conflictIndex);
    return true;
  });
}

test('portable path profiles accept non-empty POSIX-relative paths without rewriting them', () => {
  for (const profile of ['output', 'repo', 'archive']) {
    const value = 'reports/Architecture Café 2026.html';
    assert.equal(validatePortablePath(value, { profile }), value);
  }

  assert.equal(
    validatePortablePath('source/NUL.txt', { profile: 'repo' }),
    'source/NUL.txt',
    'repository paths remain able to describe names that cannot be checked out on Windows',
  );
  assert.equal(validatePortablePath('source/name:variant', { profile: 'repo' }), 'source/name:variant');
});

test('portable paths require a declared profile and string value', () => {
  assertPathError(
    () => validatePortablePath('report.html'),
    { code: 'portable-path/profile', reason: 'profile' },
  );
  assertPathError(
    () => validatePortablePath('report.html', { profile: 'unknown' }),
    { code: 'portable-path/profile', reason: 'profile' },
  );
  assertPathError(
    () => validatePortablePath(42, { profile: 'output' }),
    { code: 'portable-path/type', reason: 'type', profile: 'output' },
  );
  assertPathError(
    () => validatePortablePath('', { profile: 'output' }),
    { code: 'portable-path/empty', reason: 'empty', profile: 'output' },
  );
});

test('portable paths reject absolute, drive-relative, URI, and backslash forms', () => {
  const cases = [
    ['/report.html', 'portable-path/absolute', 'absolute'],
    ['C:/report.html', 'portable-path/absolute', 'absolute'],
    ['C:\\report.html', 'portable-path/absolute', 'absolute'],
    ['\\\\server\\share\\report.html', 'portable-path/absolute', 'absolute'],
    ['\\report.html', 'portable-path/absolute', 'absolute'],
    ['C:report.html', 'portable-path/drive-relative', 'drive-relative'],
    ['https://example.test/report.html', 'portable-path/uri', 'uri'],
    ['docs\\report.html', 'portable-path/backslash', 'backslash'],
  ];

  for (const [value, code, reason] of cases) {
    assertPathError(
      () => validatePortablePath(value, { profile: 'repo' }),
      { code, reason, profile: 'repo' },
    );
  }
});

test('portable paths reject empty, dot, and control-bearing segments', () => {
  const cases = [
    ['reports//diagram.html', 'portable-path/empty-segment', 'empty-segment', ''],
    ['reports/', 'portable-path/empty-segment', 'empty-segment', ''],
    ['./diagram.html', 'portable-path/dot-segment', 'dot-segment', '.'],
    ['reports/../diagram.html', 'portable-path/dot-segment', 'dot-segment', '..'],
    ['reports/line\nfeed.html', 'portable-path/control', 'control', 'line\nfeed.html'],
    ['reports/delete\u007f.html', 'portable-path/control', 'control', 'delete\u007f.html'],
  ];

  for (const [value, code, reason, segment] of cases) {
    assertPathError(
      () => validatePortablePath(value, { profile: 'repo' }),
      { code, reason, profile: 'repo', segment },
    );
  }
});

test('portable paths reject unpaired UTF-16 surrogates without rejecting valid pairs', () => {
  for (const profile of ['output', 'repo', 'archive']) {
    for (const surrogate of ['\ud800', '\udfff']) {
      assertPathError(
        () => validatePortablePath(`reports/${surrogate}.html`, { profile }),
        {
          code: 'portable-path/unpaired-surrogate',
          reason: 'unpaired-surrogate',
          profile,
          segment: `${surrogate}.html`,
        },
      );
    }

    assert.equal(
      validatePortablePath('reports/😀.html', { profile }),
      'reports/😀.html',
    );
  }
});

test('output and archive profiles reject Windows-invalid segment names', () => {
  for (const profile of ['output', 'archive']) {
    assertPathError(
      () => validatePortablePath('reports/diagram:stream.html', { profile }),
      {
        code: 'portable-path/windows-ads',
        reason: 'windows-ads',
        profile,
        segment: 'diagram:stream.html',
      },
    );

    for (const character of ['<', '>', '"', '|', '?', '*']) {
      const segment = `diagram${character}.html`;
      assertPathError(
        () => validatePortablePath(`reports/${segment}`, { profile }),
        {
          code: 'portable-path/windows-invalid-character',
          reason: 'windows-invalid-character',
          profile,
          segment,
        },
      );
    }

    for (const segment of ['diagram.', 'diagram ', 'folder.']) {
      assertPathError(
        () => validatePortablePath(`reports/${segment}`, { profile }),
        {
          code: 'portable-path/windows-trailing-dot-space',
          reason: 'windows-trailing-dot-space',
          profile,
          segment,
        },
      );
    }
  }
});

test('output and archive profiles reject DOS device names including superscript forms', () => {
  const reserved = [
    'CON', 'prn.txt', 'Aux.json', 'nul.html', 'CONIN$', 'conout$.txt',
    'COM1', 'com9.log', 'LPT1', 'lpt9.txt',
    'COM¹', 'com².txt', 'COM³.log',
    'LPT¹', 'lpt².txt', 'LPT³.log',
  ];

  for (const profile of ['output', 'archive']) {
    for (const segment of reserved) {
      assertPathError(
        () => validatePortablePath(`reports/${segment}`, { profile }),
        {
          code: 'portable-path/windows-reserved-name',
          reason: 'windows-reserved-name',
          profile,
          segment,
        },
      );
    }

    for (const segment of ['console.html', 'COM0', 'COM10', 'COM¹x', 'LPT0.txt']) {
      assert.equal(validatePortablePath(`reports/${segment}`, { profile }), `reports/${segment}`);
    }
  }
});

test('output and archive profiles reject Windows 8.3 short-name shapes', () => {
  for (const profile of ['output', 'archive']) {
    for (const segment of ['PROGRA~1', 'longfi~9.html', 'REPORT~12.json']) {
      assertPathError(
        () => validatePortablePath(`reports/${segment}`, { profile }),
        {
          code: 'portable-path/windows-short-name',
          reason: 'windows-short-name',
          profile,
          segment,
        },
      );
    }

    for (const segment of ['tilde~0', 'tilde~x', 'name~1suffix']) {
      assert.equal(validatePortablePath(`reports/${segment}`, { profile }), `reports/${segment}`);
    }
  }

  assert.equal(
    validatePortablePath('fixtures/PROGRA~1/source.json', { profile: 'repo' }),
    'fixtures/PROGRA~1/source.json',
    'Git paths retain POSIX spelling semantics even when a segment resembles an 8.3 alias',
  );
});

test('output and archive profiles conservatively enforce portable component sizes', () => {
  const maxAscii = 'a'.repeat(255);
  const maxMultibyte = `${'é'.repeat(127)}a`;
  for (const profile of ['output', 'archive']) {
    assert.equal(validatePortablePath(maxAscii, { profile }), maxAscii);
    assert.equal(validatePortablePath(maxMultibyte, { profile }), maxMultibyte);

    for (const segment of ['a'.repeat(256), 'é'.repeat(128)]) {
      assert.throws(
        () => validatePortablePath(segment, { profile }),
        (error) => {
          assert.ok(error instanceof PortablePathError);
          assert.equal(error.code, 'portable-path/component-too-long');
          assert.equal(error.reason, 'component-too-long');
          assert.equal(error.profile, profile);
          assert.equal(error.segment, segment);
          assert.ok(error.utf8Bytes > 255 || error.utf16CodeUnits > 255);
          assert.equal(error.limit, 255);
          return true;
        },
      );
    }
  }

  const descriptiveRepoPath = `sources/${'a'.repeat(256)}`;
  assert.equal(
    validatePortablePath(descriptiveRepoPath, { profile: 'repo' }),
    descriptiveRepoPath,
  );
});

test('portable path sets return the source array when all entries remain distinct', () => {
  const values = ['docs/Architecture.md', 'docs/architecture-v2.md', 'assets/logo.svg'];
  assert.equal(validatePortablePathSet(values, { profile: 'archive' }), values);
});

test('portable path sets preserve the invalid Windows short-name entry index', () => {
  assertPathError(
    () => validatePortablePathSet(
      ['docs/readme.md', 'fixtures/PROGRA~1/report.html'],
      { profile: 'archive' },
    ),
    {
      code: 'portable-path/windows-short-name',
      reason: 'windows-short-name',
      profile: 'archive',
      index: 1,
    },
  );
});

test('portable path sets reject exact duplicates with both source positions', () => {
  assertPathError(
    () => validatePortablePathSet(['docs/readme.md', 'docs/readme.md'], { profile: 'archive' }),
    {
      code: 'portable-path/collision',
      reason: 'duplicate',
      profile: 'archive',
      index: 1,
      conflictIndex: 0,
    },
  );
});

test('portable path sets conservatively reject case collisions', () => {
  assertPathError(
    () => validatePortablePathSet(['Docs/Readme.md', 'docs/readme.md'], { profile: 'archive' }),
    {
      code: 'portable-path/collision',
      reason: 'case',
      profile: 'archive',
      index: 1,
      conflictIndex: 0,
    },
  );
});

test('portable path sets reject case collisions found only by uppercase folding', () => {
  assertPathError(
    () => validatePortablePathSet(['docs/σ.md', 'docs/ς.md'], { profile: 'archive' }),
    {
      code: 'portable-path/collision',
      reason: 'case',
      profile: 'archive',
      index: 1,
      conflictIndex: 0,
    },
  );
});

test('portable path sets reject case-aliased directory prefixes', () => {
  assert.throws(
    () => validatePortablePathSet(['Docs/one.txt', 'docs/two.txt'], { profile: 'archive' }),
    (error) => {
      assert.ok(error instanceof PortablePathError);
      assert.equal(error.code, 'portable-path/collision');
      assert.equal(error.reason, 'directory-case');
      assert.equal(error.collisionKind, 'directory-spelling');
      assert.equal(error.semantics, 'case');
      assert.equal(error.index, 1);
      assert.equal(error.conflictIndex, 0);
      assert.equal(error.pathPart, 'docs');
      assert.equal(error.conflictPathPart, 'Docs');
      return true;
    },
  );
});

test('portable path sets reject normalization-aliased directory prefixes', () => {
  assertPathError(
    () => validatePortablePathSet(['café/one.txt', 'cafe\u0301/two.txt'], { profile: 'archive' }),
    {
      code: 'portable-path/collision',
      reason: 'directory-normalization',
      profile: 'archive',
      index: 1,
      conflictIndex: 0,
    },
  );
});

test('portable path sets allow exact shared directory prefixes', () => {
  const values = ['docs/one.txt', 'docs/nested/two.txt', 'docs/nested/three.txt'];
  assert.equal(validatePortablePathSet(values, { profile: 'archive' }), values);
});

test('portable path sets reject file and directory tree conflicts in either order', () => {
  for (const values of [
    ['docs', 'DOCS/a.txt'],
    ['DOCS/a.txt', 'docs'],
  ]) {
    assert.throws(
      () => validatePortablePathSet(values, { profile: 'archive' }),
      (error) => {
        assert.ok(error instanceof PortablePathError);
        assert.equal(error.code, 'portable-path/collision');
        assert.equal(error.reason, 'tree-file-case');
        assert.equal(error.collisionKind, 'tree-file');
        assert.equal(error.semantics, 'case');
        assert.equal(error.index, 1);
        assert.equal(error.conflictIndex, 0);
        return true;
      },
    );
  }

  assertPathError(
    () => validatePortablePathSet(['docs', 'docs/a.txt'], { profile: 'archive' }),
    {
      code: 'portable-path/collision',
      reason: 'tree-file',
      profile: 'archive',
      index: 1,
      conflictIndex: 0,
    },
  );
});

test('portable path sets conservatively reject canonical Unicode normalization collisions', () => {
  assertPathError(
    () => validatePortablePathSet(['docs/café.md', 'docs/cafe\u0301.md'], { profile: 'archive' }),
    {
      code: 'portable-path/collision',
      reason: 'normalization',
      profile: 'archive',
      index: 1,
      conflictIndex: 0,
    },
  );
});

test('portable path sets report collisions that require both case folding and normalization', () => {
  assertPathError(
    () => validatePortablePathSet(['docs/Résumé.md', 'docs/re\u0301sume\u0301.md'], { profile: 'archive' }),
    {
      code: 'portable-path/collision',
      reason: 'case-and-normalization',
      profile: 'archive',
      index: 1,
      conflictIndex: 0,
    },
  );
});

test('portable path sets close Unicode normalization and case transforms to a fixed point', () => {
  assertPathError(
    () => validatePortablePathSet(
      ['docs/\u0390.md', 'docs/\u0399\u0308\u0301.md'],
      { profile: 'archive' },
    ),
    {
      code: 'portable-path/collision',
      reason: 'case',
      profile: 'archive',
      index: 1,
      conflictIndex: 0,
    },
  );
});

test('portable path sets close Unicode directory-prefix transforms to a fixed point', () => {
  assert.throws(
    () => validatePortablePathSet(
      ['root/\u0390/one.txt', 'root/\u0399\u0308\u0301/two.txt'],
      { profile: 'archive' },
    ),
    (error) => {
      assert.ok(error instanceof PortablePathError);
      assert.equal(error.code, 'portable-path/collision');
      assert.equal(error.reason, 'directory-case');
      assert.equal(error.collisionKind, 'directory-spelling');
      assert.equal(error.semantics, 'case');
      assert.equal(error.index, 1);
      assert.equal(error.conflictIndex, 0);
      assert.equal(error.pathPart, 'root/\u0399\u0308\u0301');
      assert.equal(error.conflictPathPart, 'root/\u0390');
      return true;
    },
  );
});

test('portable path set errors preserve the invalid entry index', () => {
  assertPathError(
    () => validatePortablePathSet(['docs/readme.md', '../escape.md'], { profile: 'archive' }),
    {
      code: 'portable-path/dot-segment',
      reason: 'dot-segment',
      profile: 'archive',
      index: 1,
    },
  );
});
