import test from 'node:test';
import assert from 'node:assert/strict';
import { OPUS_FRAME_SAMPLES, audioIsComplete, decodeDiagnostics, ffmpegVersion, isFfmpeg80 } from './ffmpeg-diagnostics.mjs';

const noise = '[opus @ 0x1] Error parsing Opus packet header.';

test('FFmpeg 8.0 trailing flush line is tolerated once', () => {
  assert.deepEqual(decodeDiagnostics(`${noise}\n`, { allowFlushNoise: true }), { text: '', tolerated: 1 });
});

test('a repeated flush line leaves one diagnostic so the caller still fails', () => {
  const result = decodeDiagnostics(`${noise}\n${noise}\n`, { allowFlushNoise: true });
  assert.equal(result.text, noise);
  assert.equal(result.tolerated, 1);
});

test('a mid-stream Opus error is not tolerated', () => {
  const result = decodeDiagnostics(`${noise}\nInvalid data found when processing input\n`, { allowFlushNoise: true });
  assert.match(result.text, /Error parsing Opus packet header/);
  assert.match(result.text, /Invalid data/);
  assert.equal(result.tolerated, 0);
});

test('a preceding Opus error remains after the trailing flush is removed', () => {
  const result = decodeDiagnostics(`Invalid data found when processing input\n${noise}\n`, { allowFlushNoise: true });
  assert.equal(result.text, 'Invalid data found when processing input');
  assert.equal(result.tolerated, 1);
});

test('a Buffer input is handled like a string', () => {
  assert.deepEqual(decodeDiagnostics(Buffer.from(`${noise}\r\n`), { allowFlushNoise: true }), { text: '', tolerated: 1 });
});

test('the flush line is rejected without the 8.0 allowance', () => {
  assert.deepEqual(decodeDiagnostics(`${noise}\n`), { text: `${noise}\n`, tolerated: 0 });
});

test('whitespace-only stderr is not normalized away', () => {
  const result = decodeDiagnostics('\n  \n', { allowFlushNoise: true });
  assert.equal(result.text, '\n  \n');
  assert.equal(result.tolerated, 0);
});

test('version parsing accepts tagged and release builds but not unknown builds', () => {
  assert.equal(ffmpegVersion('ffmpeg version 8.0.1 Copyright'), '8.0');
  assert.equal(ffmpegVersion('ffmpeg version n8.0.1 Copyright'), '8.0');
  assert.equal(ffmpegVersion('ffmpeg version 6.1.6 Copyright'), '6.1');
  assert.equal(ffmpegVersion('ffmpeg version N-116043-gdeadbeef'), '');
  assert.equal(isFfmpeg80('ffmpeg version 8.0.1'), true);
  assert.equal(isFfmpeg80('ffmpeg version 8.1.2'), false);
});

test('decoded samples must match the container packet count', () => {
  assert.equal(OPUS_FRAME_SAMPLES, 960);
  assert.equal(audioIsComplete(26 * 960 - 312, 26), true);
  assert.equal(audioIsComplete(25 * 960 - 312, 26), false);
  assert.equal(audioIsComplete(26 * 960 - 312, 27), false);
  assert.equal(audioIsComplete(0, 0), false);
  assert.equal(audioIsComplete(0, 1), false);
});
