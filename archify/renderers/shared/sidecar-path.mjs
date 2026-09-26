import { createHash } from 'node:crypto';

const SIDECAR_STEM_NAMESPACE = /\.~archify-[0-9a-f]{64}$/iu;

export function sidecarStemNeedsBounding(stem, suffixes) {
  const fits = (value) => value.length <= 255 && Buffer.byteLength(value, 'utf8') <= 255;
  return !suffixes.every((suffix) => fits(`${stem}${suffix}`));
}

export function boundedSidecarStem(stem, suffixes, { force = false, hashDomain } = {}) {
  if (!force && !sidecarStemNeedsBounding(stem, suffixes)
    && !SIDECAR_STEM_NAMESPACE.test(stem)) return stem;
  const hashInput = hashDomain ? `${hashDomain}\0${stem}` : stem;
  const marker = `.~archify-${createHash('sha256').update(hashInput).digest('hex')}`;
  const codePoints = [...stem];
  while (codePoints.length
    && sidecarStemNeedsBounding(`${codePoints.join('')}${marker}`, suffixes)) {
    codePoints.pop();
  }
  return `${codePoints.join('')}${marker}`;
}

export function sidecarStemFromComponent(component) {
  if (component.endsWith('.html')) {
    return {
      stem: component.slice(0, -'.html'.length),
      options: undefined,
    };
  }
  return {
    stem: component,
    options: { force: true, hashDomain: 'full-component' },
  };
}

export function isBoundedSidecarStem(stem) {
  return SIDECAR_STEM_NAMESPACE.test(stem);
}
