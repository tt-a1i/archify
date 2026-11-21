// Decode a file the way the extractor did. Python files honour a PEP 263
// coding declaration in their first two lines (tokenize.detect_encoding);
// everything else is read as UTF-8. An encoding Node cannot decode falls back
// to UTF-8, which at worst reports the evidence as changed, never as valid.
const PYTHON_CODECS = { utf_8: 'utf-8', utf8: 'utf-8', 'utf-8': 'utf-8', utf_8_sig: 'utf-8', 'utf-8-sig': 'utf-8' };
// cp1252 is decoded from a fixed table: TextDecoder('windows-1252') differs
// between Node builds (some return the raw byte for 0x80-0x9f). Bytes Python's
// cp1252 leaves undefined become U+FFFD.
const CP1252_HIGH = [0x20ac, 0xfffd, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0xfffd, 0x017d, 0xfffd, 0xfffd, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0xfffd, 0x017e, 0x0178];
const CP1252_ALIASES = new Set(['cp1252', 'windows_1252', '1252']);
function decodeCp1252(buffer, strict) {
  let out = '';
  for (const byte of buffer) {
    const code = byte >= 0x80 && byte < 0xa0 ? CP1252_HIGH[byte - 0x80] : byte;
    if (strict && code === 0xfffd) throw new Error('undefined cp1252 source byte');
    out += String.fromCharCode(code);
  }
  return out;
}
// Python's latin_1 codec and its aliases are true ISO-8859-1 (byte n is code
// point n). WHATWG TextDecoder maps every latin-1 label to windows-1252, which
// differs for 0x80-0x9f, so these decode byte for byte instead.
const LATIN1_ALIASES = new Set(['latin_1', 'latin1', 'latin', 'l1', 'iso_8859_1', 'iso8859_1', '8859', 'cp819', 'iso_latin_1', 'iso_ir_100', 'csisolatin1']);
function isLatin1(declared) {
  const name = declared.replace(/[-\s.]/g, '_');
  // tokenize.get_normal_name also maps prefixed forms such as latin-1-unix.
  return LATIN1_ALIASES.has(name) || /^(latin_1|iso_8859_1|iso_latin_1)_/.test(name);
}

/** @param {Buffer} buffer @param {string} rel @param {{strict?: boolean}} options */
export function decodeSource(buffer, rel, { strict = false } = {}) {
  if (!/\.pyi?$/i.test(rel)) return buffer.toString('utf8');
  // tokenize.detect_encoding selects utf-8-sig for Python's UTF-8 signature.
  // Strip it before comparing decoded text or interpreting first-line columns.
  const bom = buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf;
  if (bom) buffer = buffer.subarray(3);
  const head = buffer.toString('latin1').split(/\r\n|\r|\n/, 2);
  let declared = null;
  for (const line of head) {
    const match = line.match(/^[ \t\f]*#.*?coding[:=][ \t]*([-\w.]+)/);
    if (match) { declared = match[1].toLowerCase(); break; }
    if (!/^[ \t\f]*(#.*)?$/.test(line)) break; // only a blank or comment first line lets the second declare it
  }
  if (!declared) return new TextDecoder('utf-8', { fatal: strict }).decode(buffer);
  if (bom && strict && !/^utf[-_]?8(?:[-_]sig)?$/.test(declared)) throw new Error('UTF-8 BOM disagrees with coding cookie');
  if (isLatin1(declared)) return buffer.toString('latin1');
  if (CP1252_ALIASES.has(declared.replace(/[-\s.]/g, '_'))) return decodeCp1252(buffer, strict);
  const label = PYTHON_CODECS[declared] || PYTHON_CODECS[declared.replace(/-/g, '_')] || declared.replace(/_/g, '-');
  if (strict && /^(ascii|us-ascii|us_ascii)$/.test(label) && buffer.some(byte => byte > 127)) throw new Error('non-ASCII source byte');
  try { return new TextDecoder(label, { fatal: strict }).decode(buffer); } catch (error) { if (strict) throw error; return buffer.toString('utf8'); }
}
