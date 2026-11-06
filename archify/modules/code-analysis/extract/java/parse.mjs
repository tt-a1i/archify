// Parse only captured source text. No application code, build files or annotation
// processors are executed. The CST keeps source offsets for evidence/navigation.
import { lexAndParse } from 'java-parser';
import { classifyRole, lineCount, snapshotSources, PACKAGE_MARKERS, JAVA_BUILD_MARKERS } from '../shared/files.mjs';

export const PARSER = 'java-parser@3.0.1';
export const isJavaSource = file => file.endsWith('.java');
export const TYPE_DECLARATIONS = new Set(['normalClassDeclaration', 'normalInterfaceDeclaration', 'recordDeclaration', 'enumDeclaration', 'annotationInterfaceDeclaration']);

export function typeName(node) {
  return node.children.typeIdentifier?.[0]?.children.Identifier?.[0]?.image || node.children.Identifier?.[0]?.image;
}

export function parseSources(root, config, consume = unit => unit) {
  const snapshot = snapshotSources(root, config, isJavaSource, [...PACKAGE_MARKERS, ...JAVA_BUILD_MARKERS]);
  const files = [], units = [], parse_errors = [];
  for (const [file, bytes] of snapshot.contents) {
    let sourceText;
    try {
      sourceText = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      // Keep a source record, but do not interpret replacement characters as code.
      sourceText = bytes.toString('utf8');
      parse_errors.push({ path: file, message: 'Java source must be UTF-8; this file could not be decoded.' });
    }
    files.push({ path: file, sourceText, loc: lineCount(sourceText), role: classifyRole(file, config.roles) });
    if (parse_errors.at(-1)?.path === file) continue;
    let parsed;
    try {
      const result = lexAndParse(sourceText);
      if (sourceText.includes('\\u') && needsUnicodePreprocessing(sourceText, result)) {
        throw new Error('Java Unicode escape preprocessing is required here; this file was not analyzed.');
      }
      parsed = result;
    } catch (error) {
      const message = error.message.replace(/^Sad sad panda, /, '').split('\n').slice(0, 2).join(' ').slice(0, 600);
      parse_errors.push({ path: file, message });
    }
    // The production adapter reduces each CST immediately. Keep extraction bugs
    // outside the parser catch so they cannot masquerade as bad source syntax.
    if (parsed) {
      restoreEmptyRecords(parsed.cst);
      units.push(consume({ file, sourceText, ...parsed }));
    }
  }
  return { files, units, packageMarkers: snapshot.packageMarkers, parse_errors };
}

// The parser retains literal spellings and original offsets. Escapes inside
// literals/comments can stay raw only when decoding cannot change their bounds.
// A decoded backslash can also change the eligibility of the next escape, so
// leave that case to a future preprocessing pass.
function needsUnicodePreprocessing(sourceText, parsed) {
  const spans = [...parsed.cst.comments, ...parsed.tokens.filter(token =>
    ['StringLiteral', 'CharLiteral', 'TextBlock'].includes(token.tokenType.name))]
    .sort((a, b) => a.startOffset - b.startOffset);
  let spanIndex = 0;
  // Consume pairs of raw backslashes first: their following 'u' is ineligible.
  for (const escape of sourceText.matchAll(/\\\\|\\u+([0-9a-fA-F]{4})?/g)) {
    if (escape[0] === '\\\\') continue;
    if (!escape[1] || /["'\\/*\r\n]/.test(String.fromCharCode(Number.parseInt(escape[1], 16)))) return true;
    while (spanIndex < spans.length && spans[spanIndex].endOffset < escape.index) spanIndex++;
    const span = spans[spanIndex];
    if (!span || span.startOffset > escape.index || span.endOffset < escape.index + escape[0].length - 1) return true;
  }
  return false;
}

// java-parser 3.0.1 reads a member record whose body is also a valid block,
// such as `record Value(int x) {}` or `record Value(int x) { class Part {} }`,
// as a method returning type `record`. No such method compiles in any Java
// version: it returns a class type but declares no statement, only empty
// statements and local types. Rewrite those nodes into the record
// declarations they denote, with the local types restored as member types.
function restoreEmptyRecords(node) {
  for (const values of Object.values(node.children || {})) {
    values.forEach((child, i) => {
      if (!child.name) return;
      values[i] = misparsedRecord(child) || child;
      restoreEmptyRecords(values[i]);
    });
  }
}

function misparsedRecord(node) {
  if (node.name !== 'methodDeclaration' && node.name !== 'interfaceMethodDeclaration') return null;
  const header = node.children.methodHeader?.[0];
  const declarator = header?.children.methodDeclarator?.[0];
  const block = node.children.methodBody?.[0]?.children.block?.[0];
  if (!declarator || !block || header.children.typeParameters || header.children.throws
    || declarator.children.dims || declarator.children.receiverParameter) return null;
  if (tokensOf(header.children.result[0]).map(t => t.image).join(' ') !== 'record') return null;
  const statements = block.children.blockStatements?.[0]?.children.blockStatement || [];
  const members = [];
  for (const statement of statements) {
    if (tokensOf(statement).every(t => t.image === ';')) continue;
    const [declaration, ...rest] = children(statement);
    if (rest.length || !['classDeclaration', 'interfaceDeclaration'].includes(declaration?.name)) return null;
    members.push(declaration);
  }
  const wrap = (kind, location, child) => ({ name: kind, location, children: { [child.name]: [child] } });
  const name = declarator.children.Identifier[0];
  const { methodHeader: _header, methodBody: _body, ...modifiers } = node.children;
  return {
    name: 'recordDeclaration', location: node.location,
    children: {
      ...modifiers,
      typeIdentifier: [{ name: 'typeIdentifier', location: tokenLocation(name), children: { Identifier: [name] } }],
      recordHeader: [{ name: 'recordHeader', location: declarator.location, children: { formalParameterList: declarator.children.formalParameterList || [] } }],
      recordBody: [{ name: 'recordBody', location: block.location, children: members.length ? {
        recordBodyDeclaration: members.map(member => wrap('recordBodyDeclaration', member.location,
          wrap('classBodyDeclaration', member.location, wrap('classMemberDeclaration', member.location, member)))),
      } : {} }],
    },
  };
}

function tokenLocation(token) {
  const { startOffset, endOffset, startLine, endLine, startColumn, endColumn } = token;
  return { startOffset, endOffset, startLine, endLine, startColumn, endColumn };
}

export function children(node) {
  return Object.values(node.children || {}).flat().filter(child => child.name)
    .sort((a, b) => a.location.startOffset - b.location.startOffset);
}

export function* descendants(node) {
  yield node;
  for (const child of children(node)) yield* descendants(child);
}

export function tokensOf(node) {
  return Object.values(node.children || {}).flat().flatMap(child => child.name ? tokensOf(child) : [child])
    .sort((a, b) => a.startOffset - b.startOffset);
}
