import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  resolveNativeOutputDirectory,
  resolveOutputPath,
  validateNativeOutputPath,
} from '../renderers/shared/output-path.mjs';

function nativeFailure(value, options) {
  assert.throws(
    () => validateNativeOutputPath(value, options),
    (error) => error?.archifyDiagnostics?.[0]?.code === 'output/native-path-syntax',
  );
}

test('Windows CLI outputs retain native absolute, UNC, extended, and relative forms', () => {
  for (const value of [
    String.raw`C:\reports\diagram.html`,
    String.raw`\\server\share\reports\diagram.html`,
    String.raw`\\server\CON\reports\diagram.html`,
    '//server/share/reports/diagram.html',
    String.raw`\\?\C:\reports\diagram.html`,
    String.raw`\\?\UNC\server\share\reports\diagram.html`,
    String.raw`\\?\UNC\server\CON\reports\diagram.html`,
    String.raw`reports\diagram.html`,
    String.raw`..\diagram.html`,
    String.raw`.\reports\..\diagram.html`,
    String.raw`C:\reports\..\diagram.html`,
    String.raw`\\server\share\reports\..\diagram.html`,
    String.raw`C:\ARCHIF~1\diagram.html`,
    `C:\\reports\\${'界'.repeat(100)}.html`,
    `\\\\?\\C:\\reports\\${'界'.repeat(100)}.html`,
  ]) {
    assert.equal(validateNativeOutputPath(value, { platform: 'win32' }), value);
  }
});

test('Windows CLI outputs reject ambiguous or special namespace forms', () => {
  for (const value of [
    String.raw`C:`,
    String.raw`C:diagram.html`,
    String.raw`C:\reports\diagram.html:payload`,
    String.raw`\\.\NUL`,
    '//./NUL/diagram.html',
    String.raw`\\?\GLOBALROOT\Device\HarddiskVolume1\diagram.html`,
    '//?/GLOBALROOT/Device/HarddiskVolume1/diagram.html',
    String.raw`\\?/GLOBALROOT\Device\HarddiskVolume1\diagram.html`,
    String.raw`\\?\\C:diagram.html`,
    String.raw`\\?\foo.html`,
    String.raw`\\ser?ver\share\file.html`,
    String.raw`\reports\diagram.html`,
    String.raw`C:\reports\CON.html`,
    String.raw`C:\reports\diagram .html `,
    String.raw`C:\reports\bad?.html`,
    String.raw`\\localhost\pipe\diagram.html`,
    String.raw`\\server\mailslot\diagram.html`,
    String.raw`\\server\IPC$\diagram.html`,
    String.raw`\\?\UNC\localhost\pipe\diagram.html`,
    String.raw`\\?\UNC\server\MAILSLOT\diagram.html`,
    String.raw`\\?\UNC\server\ipc$\diagram.html`,
  ]) nativeFailure(value, { platform: 'win32' });
});

test('Windows UNC share names use SMB share syntax rather than DOS file-device rules', () => {
  for (const value of [
    String.raw`\\server\CON\diagram.html`,
    String.raw`\\CON\share\diagram.html`,
    String.raw`\\?\UNC\server\CON\diagram.html`,
    String.raw`\\?\UNC\CON\share\diagram.html`,
  ]) {
    assert.equal(validateNativeOutputPath(value, { platform: 'win32' }), value);
  }

  for (const value of [
    String.raw`\\server\bad+share\diagram.html`,
    String.raw`\\server\trailing.\diagram.html`,
    `\\\\server\\${'x'.repeat(81)}\\diagram.html`,
    String.raw`\\?\UNC\server\bad,share\diagram.html`,
    String.raw`\\?\UNC\server\trailing \diagram.html`,
  ]) {
    assert.throws(
      () => validateNativeOutputPath(value, { platform: 'win32' }),
      (error) => error?.archifyDiagnostics?.[0]?.evidence?.reason === 'windows-unc-share-name',
      value,
    );
  }
});

test('Windows IPC shares fail before output resolution touches the filesystem', (t) => {
  let realpathCalls = 0;
  let lstatCalls = 0;
  t.mock.method(fs.realpathSync, 'native', () => {
    realpathCalls += 1;
    throw new Error('unexpected realpath');
  });
  t.mock.method(fs, 'lstatSync', () => {
    lstatCalls += 1;
    throw new Error('unexpected lstat');
  });

  for (const requestedOutput of [
    String.raw`\\server\IPC$\diagram.html`,
    String.raw`\\server\pipe\diagram.html`,
    String.raw`\\server\mailslot\diagram.html`,
    String.raw`\\?\UNC\server\IPC$\diagram.html`,
    String.raw`\\?\UNC\server\pipe\diagram.html`,
    String.raw`\\?\UNC\server\mailslot\diagram.html`,
  ]) {
    assert.throws(
      () => resolveOutputPath({
        requestedOutput,
        defaultOutput: 'diagram.html',
        platform: 'win32',
      }),
      (error) => error?.archifyDiagnostics?.[0]?.evidence?.reason === 'windows-ipc-namespace',
      requestedOutput,
    );
  }
  assert.equal(realpathCalls, 0);
  assert.equal(lstatCalls, 0);
});

test('Windows native output directories validate raw spelling before resolution', () => {
  const cwd = String.raw`C:\workspace\project`;
  const invalid = [
    [String.raw`C:evidence`, 'drive-relative'],
    [String.raw`\evidence`, 'current-drive-rooted'],
    [String.raw`\\.\NUL`, 'windows-device-namespace'],
    [String.raw`C:\reports\evidence:stream`, 'windows-ads'],
    [String.raw`C:\reports\CON`, 'windows-reserved-name'],
    [String.raw`C:\reports\evidence.`, 'windows-trailing-dot-space'],
    [String.raw`C:\reports\evidence `, 'windows-trailing-dot-space'],
  ];
  for (const [value, reason] of invalid) {
    assert.throws(
      () => resolveNativeOutputDirectory(value, { platform: 'win32', cwd }),
      (error) => {
        const diagnostic = error?.archifyDiagnostics?.[0];
        return diagnostic?.code === 'output/native-path-syntax'
          && diagnostic?.subject?.output === value
          && diagnostic?.evidence?.reason === reason;
      },
      value,
    );
  }

  assert.equal(
    resolveNativeOutputDirectory('evidence', { platform: 'win32', cwd }),
    String.raw`C:\workspace\project\evidence`,
  );
  assert.equal(
    resolveNativeOutputDirectory(String.raw`D:\evidence`, { platform: 'win32', cwd }),
    String.raw`D:\evidence`,
  );
});

test('native file outputs reject a trailing separator before normalization', (t) => {
  const normalize = path.win32.normalize.bind(path.win32);
  let normalizeCalls = 0;
  t.mock.method(path.win32, 'normalize', (...args) => {
    normalizeCalls += 1;
    return normalize(...args);
  });

  for (const value of [
    'C:\\reports\\diagram.html\\',
    '\\\\server\\share\\diagram.html\\',
    '\\\\?\\C:\\reports\\diagram.html\\',
    '\\\\?\\UNC\\server\\share\\diagram.html\\',
  ]) {
    assert.throws(
      () => validateNativeOutputPath(value, { platform: 'win32' }),
      (error) => error?.archifyDiagnostics?.[0]?.evidence?.reason === 'trailing-separator',
      value,
    );
  }
  assert.equal(normalizeCalls, 0);
  nativeFailure('/tmp/archive.zip/', { platform: 'linux' });
});

test('native output directories retain one trailing separator', () => {
  const cwd = String.raw`C:\workspace\project`;
  for (const [value, expected] of [
    ['C:\\reports\\', String.raw`C:\reports`],
    ['\\\\server\\share\\reports\\', String.raw`\\server\share\reports`],
    ['\\\\?\\C:\\reports\\', String.raw`\\?\C:\reports`],
    ['\\\\?\\UNC\\server\\share\\reports\\', String.raw`\\?\UNC\server\share\reports`],
  ]) {
    assert.equal(
      validateNativeOutputPath(value, { platform: 'win32', kind: 'directory' }),
      value,
    );
    assert.equal(resolveNativeOutputDirectory(value, { platform: 'win32', cwd }), expected);
  }
  assert.equal(
    validateNativeOutputPath('/tmp/evidence/', { platform: 'linux', kind: 'directory' }),
    '/tmp/evidence/',
  );
});

test('Windows CLI outputs reject malformed raw UNC roots before normalization', () => {
  for (const value of [
    String.raw`\\server\\share\report.html`,
    '//server//share/report.html',
    String.raw`\\server\/share\report.html`,
    String.raw`\\server/share\report.html`,
    String.raw`//server\share/report.html`,
  ]) {
    assert.throws(
      () => validateNativeOutputPath(value, { platform: 'win32' }),
      (error) => error?.archifyDiagnostics?.[0]?.evidence?.reason === 'windows-unc-root',
    );
  }
});

test('Windows extended paths preserve raw namespace semantics', () => {
  for (const value of [
    String.raw`\\?\C:\reports\..\diagram.html`,
    String.raw`\\?\C:\reports\.\diagram.html`,
    String.raw`\\?\C:\reports\\diagram.html`,
    String.raw`\\?\UNC\server\share\..\other\diagram.html`,
    String.raw`\\?\UNC\server\share\.\diagram.html`,
    String.raw`\\?\UNC\server\share\reports\\diagram.html`,
    String.raw`\\?\C:/reports/diagram.html`,
    String.raw`\\?\UNC/server/share/diagram.html`,
    '//?/C:/reports/diagram.html',
    String.raw`\\?\C:diagram.html`,
    String.raw`\\?\UNC\server`,
    String.raw`\\?\UNC\\share\diagram.html`,
    String.raw`\\?\Device\HarddiskVolume1\diagram.html`,
    String.raw`\\?\Volume{01234567-89AB-CDEF-0123-456789ABCDEF}\reports\diagram.html`,
  ]) nativeFailure(value, { platform: 'win32' });
});

test('native outputs reject unpaired UTF-16 surrogates without rejecting valid pairs', () => {
  for (const platform of ['darwin', 'linux', 'win32']) {
    for (const surrogate of ['\ud800', '\udfff']) {
      assert.throws(
        () => validateNativeOutputPath(`reports/${surrogate}.html`, { platform }),
        (error) => error?.archifyDiagnostics?.[0]?.evidence?.reason === 'unpaired-surrogate',
      );
    }
    const emojiOutput = 'reports/\ud83d\ude00.html';
    assert.equal(validateNativeOutputPath(emojiOutput, { platform }), emojiOutput);
  }
});

test('native output validation rejects components that cannot host derived files', () => {
  nativeFailure(`/tmp/${'é'.repeat(128)}.html`, { platform: 'linux' });
  nativeFailure(`C:\\reports\\${'x'.repeat(256)}.html`, { platform: 'win32' });
  nativeFailure(`C:\\reports\\${'x'.repeat(256)}~1.html`, { platform: 'win32' });
});

test('resolveOutputPath applies Windows native validation to explicit outputs before resolution', () => {
  assert.throws(
    () => resolveOutputPath({
      requestedOutput: String.raw`C:\reports\NUL.html`,
      defaultOutput: 'diagram.html',
      platform: 'win32',
    }),
    (error) => error?.archifyDiagnostics?.[0]?.evidence?.reason === 'windows-reserved-name',
  );
});

test('POSIX CLI outputs are not forced through Windows spelling rules', () => {
  for (const value of ['reports/CON.html', 'reports/name:stream.html', 'reports/name .html']) {
    assert.equal(validateNativeOutputPath(value, { platform: 'linux' }), value);
  }
  nativeFailure('reports/diagram\0.html', { platform: 'linux' });
});
