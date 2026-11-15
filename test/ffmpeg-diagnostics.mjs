const OPUS_FLUSH_NOISE = /^\[opus @ [^\]]+\] Error parsing Opus packet header\.$/;

export function ffmpegVersion(output) {
  const match = /ffmpeg version n?(\d+)\.(\d+)/.exec(String(output || ''));
  return match ? `${match[1]}.${match[2]}` : '';
}

/** Exact 8.0.x gate: the Ubuntu 8.0.1 build has the parser bug; unknown or newer builds fail closed. */
export function isFfmpeg80(output) {
  return ffmpegVersion(output) === '8.0';
}

/**
 * Remove only the one known FFmpeg 8.0.x EOF flush line (upstream issue 20954).
 * A line anywhere else in the log, a repeat, or any other diagnostic remains.
 * Without a tolerated line the original stderr is returned verbatim; when one is
 * removed, `text` is the normalized remaining lines.
 */
export function decodeDiagnostics(stderr, { allowFlushNoise = false } = {}) {
  const raw = stderr == null ? '' : stderr.toString();
  const lines = raw.split('\n').map(line => line.trim()).filter(Boolean);
  if (allowFlushNoise && lines.length && OPUS_FLUSH_NOISE.test(lines[lines.length - 1])) {
    return { text: lines.slice(0, -1).join('\n'), tolerated: 1 };
  }
  return { text: raw, tolerated: 0 };
}

/** WebCodecs AudioEncoder defaults to 20 ms Opus frames; story-export.js does not set frameDuration, and story-webm.js:18 writes CodecDelay without DiscardPadding. */
export const OPUS_FRAME_SAMPLES = 960;

/** A complete Opus track decodes within one packet-frame of its packet count. */
export function audioIsComplete(decodedSamples, packetCount, frameSamples = OPUS_FRAME_SAMPLES) {
  return Number.isInteger(decodedSamples) && Number.isInteger(packetCount) && packetCount > 0 &&
    decodedSamples > 0 && Math.abs(decodedSamples - packetCount * frameSamples) < frameSamples;
}
