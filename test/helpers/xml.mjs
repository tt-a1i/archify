import { parse, parseFragment } from 'parse5';
import { SaxesParser } from 'saxes';

function visit(node, callback, insideSvg = false) {
  callback(node, insideSvg);
  const childInsideSvg = insideSvg || node.tagName === 'svg';
  for (const child of node.childNodes || []) visit(child, callback, childInsideSvg);
  if (node.content) visit(node.content, callback, childInsideSvg);
}

export function parseXml(source) {
  return new SaxesParser({ xmlns: true }).write(source).close();
}

export function extractSvgs(markup, fragment = false) {
  const document = fragment
    ? parseFragment(markup, { sourceCodeLocationInfo: true })
    : parse(markup, { sourceCodeLocationInfo: true });
  const direct = [];
  const srcdocs = [];

  visit(document, (node, insideSvg) => {
    if (node.tagName === 'svg' && !insideSvg && node.sourceCodeLocation) {
      direct.push(markup.slice(node.sourceCodeLocation.startOffset, node.sourceCodeLocation.endOffset));
    }
    const srcdoc = node.attrs?.find((attribute) => attribute.name === 'srcdoc');
    if (srcdoc) srcdocs.push(srcdoc.value);
  });

  return {
    direct,
    embedded: srcdocs.flatMap((srcdoc) => {
      const nested = extractSvgs(srcdoc, true);
      return [...nested.direct, ...nested.embedded];
    }),
  };
}
