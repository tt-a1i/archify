import { SaxesParser } from 'saxes';

export function extractInlineSvgs(source) {
  return source.match(/<svg\b[\s\S]*?<\/svg>/g) || [];
}

export function parseXml(source) {
  return new SaxesParser({ xmlns: true }).write(source).close();
}
