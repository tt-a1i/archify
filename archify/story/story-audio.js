// Preview and export use the same samples and action cues.
globalThis.StorySound = (() => {
  const rate = 48000;
  let bed;
  function music() {
    if (bed) return bed;
    const length = rate * 30;
    const left = new Float32Array(length), right = new Float32Array(length);
    for (const [index, hz] of [146.832, 220, 277.183, 369.994].entries()) {
      const pan = index % 2 ? .35 : -.35;
      // A periodic bed joins without a fade or phase reset at the loop boundary.
      const fundamental = Math.round(hz * 30) / 30, overtone = Math.round(hz * 2.003 * 30) / 30;
      for (let i = 0; i < length; i++) {
        const t = i / rate, envelope = .82 + .18 * Math.sin(2 * Math.PI * t / 10 + index * .3);
        const sample = (Math.sin(2 * Math.PI * fundamental * t) + .18 * Math.sin(2 * Math.PI * overtone * t)) * envelope * .02;
        left[i] += sample * Math.sqrt((1 - pan) / 2);
        right[i] += sample * Math.sqrt((1 + pan) / 2);
      }
    }
    let peak = 0;
    for (let i = 0; i < length; i++) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
    for (let i = 0; i < length; i++) { left[i] *= .23 / peak; right[i] *= .23 / peak; }
    return bed = [left, right];
  }
  function renderer(duration, cues = [], start = 0) {
    const end = Math.ceil(duration * rate), base = music();
    let position = Math.round(start * rate);
    // One continuous air source, with soft movement envelopes and a shared tail.
    const movements = cues.filter(cue => cue.kind === 'move' || cue.kind === 'flow' || (cue.kind === 'local' && cue.move))
      .map(cue => ({at: cue.at, duration: cue.kind === 'local' ? cue.moveDuration : cue.duration, pan: cue.pan || 0, level: cue.kind === 'flow' ? .13 : .09}));
    let seed = 23991, low = 0, previous = 0, airGain = 0, airPan = 0;
    return seconds => {
      const length = Math.max(0, Math.min(Math.round(seconds * rate), end - position));
      const left = new Float32Array(length), right = new Float32Array(length);
      const activeMovements = movements.filter(cue => cue.at * rate < position + length && (cue.at + cue.duration) * rate >= position);
      for (let i = 0; i < length; i++) {
        const absolute = position + i, fade = Math.min(1, absolute / (rate * 1.2), (end - absolute) / (rate * .8));
        left[i] = base[0][absolute % base[0].length] * fade;
        right[i] = base[1][absolute % base[1].length] * fade;
        const time = absolute / rate;
        let target = 0, pan = 0;
        for (const movement of activeMovements) {
          const progress = (time - movement.at) / movement.duration;
          if (progress < 0 || progress > 1) continue;
          const weight = Math.sin(Math.PI * progress) ** 2 * movement.level;
          target += weight; pan += weight * (movement.pan + (progress - .5) * .5);
        }
        airGain += (target - airGain) * (target > airGain ? 1 / (rate * .08) : 1 / (rate * .38));
        airPan += ((target ? pan / target : airPan) - airPan) / (rate * .12);
        seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
        low += .08 * (seed / 2147483648 - 1 - low);
        const airy = low - previous; previous += .015 * (low - previous);
        const sample = airy * airGain * Math.min(1, (end - absolute) / (rate * .5));
        left[i] += sample * Math.sqrt((1 - Math.max(-.9, Math.min(.9, airPan))) / 2);
        right[i] += sample * Math.sqrt((1 + Math.max(-.9, Math.min(.9, airPan))) / 2);
      }
      for (const cue of cues) {
        if (cue.kind === 'move' || cue.kind === 'flow') continue;
        const offset = Math.round(cue.at * rate) - position, count = Math.round(cue.duration * rate);
        for (let i = Math.max(0, -offset); i < count && offset + i < length; i++) {
          const t = i / rate, p = i / count;
          let sample, pan = cue.pan || 0;
          if (cue.kind === 'local') {
            const phraseStart = .08, span = cue.duration - phraseStart;
            sample = 0;
            for (const [voice, hz] of [440, 554.365, 659.255].entries()) {
              const age = t - phraseStart - voice * span * .18;
              if (age < 0) continue;
              const envelope = Math.min(1, age / .025) * Math.exp(-age / (span * .48)) * Math.min(1, (cue.duration - t) / .3);
              sample += (Math.sin(2 * Math.PI * hz * age) + .18 * Math.sin(2 * Math.PI * hz * 2.003 * age)) * envelope * .028;
            }
          } else {
            const hz = cue.hz || 880;
            const gain=cue.kind==='enter'?.045:cue.kind==='intro-root'?.026:.018;
            const envelope=Math.min(1,t/(cue.kind==='intro-root'?.04:.009))*Math.exp(-p*(cue.kind==='intro-root'?4:7));
            sample = (Math.sin(2 * Math.PI * hz * t) + .18 * Math.sin(2 * Math.PI * hz * 2.003 * t)) * envelope * gain;
          }
          pan = Math.max(-.9, Math.min(.9, pan));
          left[offset + i] += sample * Math.sqrt((1 - pan) / 2);
          right[offset + i] += sample * Math.sqrt((1 + pan) / 2);
        }
      }
      position += length;
      return {rate, channels: [left, right]};
    };
  }
  function render(duration, cues = []) { return renderer(duration, cues)(duration); }
  function wav(sound, start = 0, duration = sound.channels[0].length / sound.rate - start) {
    const offset = Math.round(start * sound.rate), count = Math.round(duration * sound.rate);
    const bytes = new Uint8Array(44 + count * 4), view = new DataView(bytes.buffer);
    const word = (at, text) => { for (let i = 0; i < text.length; i++) bytes[at + i] = text.charCodeAt(i); };
    word(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); word(8, 'WAVEfmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true);
    view.setUint32(24, sound.rate, true); view.setUint32(28, sound.rate * 4, true);
    view.setUint16(32, 4, true); view.setUint16(34, 16, true); word(36, 'data'); view.setUint32(40, count * 4, true);
    for (let i = 0; i < count; i++) for (let channel = 0; channel < 2; channel++) {
      view.setInt16(44 + i * 4 + channel * 2, Math.round(Math.max(-1, Math.min(1, sound.channels[channel][offset + i] || 0)) * 32767), true);
    }
    return bytes;
  }
  return {render, renderer, wav};
})();
