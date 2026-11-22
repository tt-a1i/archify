// An excerpt lexer for color only. Keep every source character and leave
// unrecognized syntax unstyled.
const languages = [
  ['js mjs cjs jsx ts tsx', '//', '/* */', 'const let var function class extends implements interface type enum async await import export from as default new return throw try catch finally if else switch case for while do break continue in of typeof instanceof void delete yield this super public private protected readonly static satisfies keyof', 'true false null undefined NaN Infinity'],
  ['py', '#', '', 'def class import from as async await return yield raise try except finally if elif else for while with break continue lambda pass in is and or not assert del global nonlocal match case', 'True False None'],
  ['go', '//', '/* */', 'package import func type struct interface map chan const var defer go select range return if else for switch case default break continue fallthrough goto', 'true false nil iota'],
  ['rs', '//', '/* */', 'fn let mut const static struct enum impl trait pub mod use crate self super match if else loop while for in return break continue move async await unsafe extern dyn where as ref type', 'true false Some None Ok Err'],
  ['java', '//', '/* */', 'package import class interface enum record extends implements public private protected static final abstract void boolean int long float double char byte short new this super return throw throws try catch finally if else switch case for while do break continue synchronized instanceof', 'true false null'],
  ['c cc cpp h hpp', '//', '/* */', 'include define pragma ifdef endif auto extern static const constexpr volatile inline namespace using template typename class struct enum union public private protected void bool int long float double char unsigned signed short new delete return if else switch case for while do break continue try catch throw sizeof nullptr', 'true false NULL nullptr'],
  ['json', '', '', '', 'true false null'],
  ['sql', '--', '/* */', 'select from where join inner outer left right cross on as union all distinct group by having order asc desc limit offset insert into values update set delete create alter drop table view index with recursive case when then else end and or not is in like exists returning begin commit rollback', 'true false null'],
  ['sh bash zsh', '#', '', 'if then elif else fi for in do done while until case esac function local export readonly declare set unset return exit trap source', 'true false'],
  ['yml yaml', '#', '', '', 'true false null yes no on off'],
  ['css', '', '/* */', 'important media supports layer import keyframes container', 'inherit initial unset none transparent'],
  ['html xml', '', '<!-- -->', '', ''],
];

const profiles = new Map();
for (const [extensions, lineComment, blockComment, keywords, literals] of languages) {
  const [language] = extensions.split(' ');
  const [open, close] = blockComment.split(' ');
  const multiline = new Map();
  if (open) multiline.set(open, { close, kind: 'comment' });
  if (language === 'py') {
    for (const quote of ['"""', "'''"]) multiline.set(quote, { close: quote, kind: 'string' });
  }
  if (language === 'js' || language === 'go') multiline.set('`', { close: '`', kind: 'string' });
  const prefix = [...multiline.keys(), lineComment].filter(Boolean)
    .map(token => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const quotes = language === 'rs' ? /"(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])'/
    : /"(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?/;
  const lexer = new RegExp([
    prefix && `(?<opener>${prefix})`,
    `(?<string>${quotes.source})`,
    /(?<number>0(?:x[\da-fA-F_]+|b[01_]+|o[0-7_]+)|(?:\d[\d_]*(?:\.[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?[\d_]+)?n?)/.source,
    ['html', 'css', 'yml'].includes(language)
      ? /(?<word>[$_\p{L}][$\p{L}\p{N}_-]*)/.source
      : /(?<word>[$_\p{L}][$\p{L}\p{N}_]*)/.source,
    /(?<operator>[+*/%=!<>|&^~?:.,;{}()[\]@#\\-])/.source,
  ].filter(Boolean).join('|'), 'gu');
  const profile = {
    language, lexer, multiline, lineComment,
    keywords: new Set(keywords.split(' ')), literals: new Set(literals.split(' ')),
  };
  for (const ext of extensions.split(' ')) profiles.set(ext, profile);
}

function classifyWord(word, line, start, end, profile) {
  const normalized = ['sql', 'yml', 'css'].includes(profile.language) ? word.toLowerCase() : word;
  if (profile.literals.has(normalized)) return 'number';
  if (profile.keywords.has(normalized)) return 'keyword';
  if (profile.language === 'html' && /<\/?$/.test(line.slice(Math.max(0, start - 2), start))) return 'keyword';
  if (/^\s*\(/.test(line.slice(end)) || /^\p{Lu}/u.test(word)) return 'function';
  return null;
}

function multilineEnd(line, start, { close, kind }) {
  let end = line.indexOf(close, start);
  while (end !== -1 && kind === 'string') {
    let before = end;
    while (before > start && line[before - 1] === '\\') before -= 1;
    if ((end - before) % 2 === 0) break;
    end = line.indexOf(close, end + close.length);
  }
  return end === -1 ? -1 : end + close.length;
}

export function highlightSourceLines(path, fileLines, lineNumbers) {
  const profile = profiles.get(/\.([^.\/]+)$/.exec(path)?.[1].toLowerCase());
  const tokensByLine = new Map();
  if (!profile) return tokensByLine;
  const selected = new Set(lineNumbers);
  const lastLine = Math.max(...lineNumbers);
  let multiline = null;
  for (let number = 1; number <= lastLine; number += 1) {
    const line = (fileLines[number - 1] || '').replace(/\t/g, '  ');
    const tokens = [];
    const { lexer } = profile;
    const add = (start, end, kind) => {
      if (!kind || start >= end || !selected.has(number)) return;
      const previous = tokens.at(-1);
      if (previous?.end === start && previous.kind === kind) previous.end = end;
      else tokens.push({ start, end, kind });
    };
    lexer.lastIndex = 0;
    if (multiline) {
      const end = multilineEnd(line, 0, multiline);
      add(0, end === -1 ? line.length : end, multiline.kind);
      if (end !== -1) {
        lexer.lastIndex = end;
        multiline = null;
      }
    }
    while (!multiline) {
      const match = lexer.exec(line);
      if (!match) break;
      const { opener, string, number: numeric, word } = match.groups;
      if (opener && opener === profile.lineComment) {
        add(match.index, line.length, 'comment');
        break;
      }
      if (opener) {
        const block = profile.multiline.get(opener);
        const end = multilineEnd(line, lexer.lastIndex, block);
        add(match.index, end === -1 ? line.length : end, block.kind);
        lexer.lastIndex = end;
        if (end === -1) multiline = block;
      } else {
        const kind = string ? 'string' : numeric ? 'number'
          : word ? classifyWord(word, line, match.index, lexer.lastIndex, profile) : 'operator';
        add(match.index, lexer.lastIndex, kind);
      }
    }
    if (tokens.length) tokensByLine.set(number, tokens);
  }
  return tokensByLine;
}
