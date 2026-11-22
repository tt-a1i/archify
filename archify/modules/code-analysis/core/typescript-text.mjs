// Match TypeScript's BOM-aware decoding. Source captures retain their historical
// UTF-8 BOM representation; configuration reads discard that signature.
export function decodeTypeScriptText(bytes, preserveUtf8Bom = false) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.subarray(2).toString('utf16le');
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    const swapped = Buffer.from(bytes.subarray(2));
    for (let i = 0; i + 1 < swapped.length; i += 2) [swapped[i], swapped[i + 1]] = [swapped[i + 1], swapped[i]];
    return swapped.toString('utf16le');
  }
  const text = bytes.toString('utf8');
  return preserveUtf8Bom ? text : text.replace(/^\uFEFF/, '');
}
