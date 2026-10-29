import { PeleError, detectType, parse, register, render } from './vendor/pele/core.js';
import pie from './vendor/pele/diagrams/pie.js';
import xychart from './vendor/pele/diagrams/xychart.js';
import quadrantChart from './vendor/pele/diagrams/quadrantChart.js';
import sankey from './vendor/pele/diagrams/sankey.js';
import radar from './vendor/pele/diagrams/radar.js';
import venn from './vendor/pele/diagrams/venn.js';

register(pie, xychart, quadrantChart, sankey, radar, venn);

const NATIVE = { flowchart: 'workflow or architecture', sequence: 'sequence', class: 'class', er: 'erd', state: 'lifecycle', timeline: 'timeline', gantt: 'timeline or waterfall', mindmap: 'tree', treeView: 'tree' };

// Decorate parsed sections so configuration prefixes and accepted label syntax retain the
// same value/share legend. Rendering the same model also preserves its parsed configuration.
function pieLegend(model) {
  const total = [...model.sections.values()].reduce((sum, value) => sum + value, 0);
  if (!(total > 0)) return model;
  model.showData = false;
  model.sections = new Map([...model.sections].map(([label, value]) => {
    const share = Math.round(value / total * 100);
    return [`${label} · ${value}${/\p{Script=Han}/u.test(label) ? `（${share}%）` : ` (${share}%)`}`, value];
  }));
  return model;
}

/** Render a Mermaid chart to static SVG, or return a located diagnostic reason. */
export function compileExplainerChart(text) {
  const type = detectType(text);
  if (type && NATIVE[type]) return { error: `Mermaid ${type} is drawn with the native ${NATIVE[type]} shorthand, which Archify validates and lets readers explore.`, example: `@${NATIVE[type].split(' ')[0]} id=...` };
  try {
    const input = type === 'pie' ? pieLegend(parse(text)) : text;
    const result = render(input, { padding: 8, fontSize: 13, links: false, images: false, config: { xyChart: { width: 480, height: 260, showDataLabel: true }, quadrantChart: { chartWidth: 400, chartHeight: 400 } } });
    // A rotated CJK axis title lies on its side; vertical writing keeps the characters upright.
    const svg = result.svg.replace(/<g transform="translate\(([\d.-]+),([\d.-]+)\) rotate\(-90\)"><text x="0" y="[\d.-]+" text-anchor="middle">([^<]*\p{Script=Han}[^<]*)<\/text><\/g>/gu, (_, x, y, label) => `<text x="${x}" y="${y}" text-anchor="middle" writing-mode="vertical-rl">${label}</text>`);
    return { svg, width: result.width, height: result.height, type: result.type };
  } catch (error) {
    if (!(error instanceof PeleError)) throw error;
    const supported = 'pie, xychart-beta (bar and line), quadrantChart, sankey-beta, radar-beta or venn-beta';
    return { error: error.code === 'unsupported-diagram' ? `A chart fence supports ${supported}.` : error.message.split('\n')[0], line: error.line, example: 'pie title Share\n  "A" : 60\n  "B" : 40' };
  }
}

// 引号内的换行属于字段，而非下一条记录；保留字段内容后再按列解释数据。
function csvRecords(text) {
  const records = [];
  let fields = [], field = '', state = 'plain', line = 1, startLine = 1, quoteLine = 1;
  let hasRecord = false;
  const error = message => ({ error: `CSV line ${line}, field ${fields.length + 1}: ${message}` });
  const endField = () => {
    fields.push(field);
    field = '';
    state = 'plain';
  };
  const endRecord = () => {
    if (hasRecord || fields.length || field.trim()) {
      endField();
      records.push({ fields, line: startLine });
    }
    fields = [];
    field = '';
    state = 'plain';
    hasRecord = false;
  };
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (state === 'quoted') {
      if (character === '"') {
        if (text[index + 1] === '"') { field += '"'; index++; }
        else state = 'closed';
      } else if (character === '\r' || character === '\n') {
        // CSV 的 CRLF/CR 与 LF 在图内都表示一次换行，原数据字节仍由交付层冻结。
        field += '\n';
        if (character === '\r' && text[index + 1] === '\n') index++;
        line++;
      } else field += character;
      continue;
    }
    if (character === ',') { endField(); hasRecord = true; continue; }
    if (character === '\r' || character === '\n') {
      endRecord();
      if (character === '\r' && text[index + 1] === '\n') index++;
      line++;
      startLine = line;
      continue;
    }
    if (state === 'closed') {
      if (/\s/u.test(character)) continue;
      return error('Unexpected text after a closing quote. End the field with a comma or newline; double a literal quote inside the quoted field.');
    }
    if (character === '"') {
      if (field.trim()) return error('A quote must start a quoted field. Quote the whole field and write each literal quote as "".');
      field = '';
      state = 'quoted';
      quoteLine = line;
      hasRecord = true;
    } else field += character;
  }
  if (state === 'quoted') return error(`The quoted field opened on line ${quoteLine} is not closed. Add its closing quote; escape literal quotes as "".`);
  endRecord();
  return { records };
}

// Pele 的 xychart 不使用 JSON 字符串转义。命名实体既保留字符，也防止原文被
// 解释成 Mermaid 实体、注释、图标或内部标记；只在数据标签入口使用，不改 chart fence。
const DATA_LABEL_ENTITIES = {
  '&': '&amp;', '"': '&quot;', '\\': '&bsol;', '<': '&lt;', '>': '&gt;',
  '#': '&num;', '%': '&percnt;', ':': '&colon;', '¶': '&para;',
};

function dataLabel(value, subject) {
  if (value === null || value === undefined || !['string', 'number', 'boolean'].includes(typeof value)
      || (typeof value === 'number' && !Number.isFinite(value))) {
    return { error: `${subject} must be text, a finite number or a boolean. Supply an explicit category label.` };
  }
  let text = String(value).replace(/\r\n?/gu, '\n');
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u2028\u2029\ud800-\udfff]/u.test(text)) {
    return { error: `${subject} contains a control character, Unicode line/paragraph separator or unpaired surrogate that the chart renderer cannot preserve. Use valid display text and LF line breaks.` };
  }
  // Ordinary label spacing is presentation, not a reason to reject a chart.
  // Keep line breaks and original data bytes; normalize only the display label.
  text = text.split('\n').map(line => line.replace(/[ \t]+/gu, ' ').trim()).join('\n').trim();
  if (!text) return { error: `${subject} is empty. Supply a nonblank category label.` };
  return { text: `"${text.replace(/[&"\\<>#%:¶]/gu, character => DATA_LABEL_ENTITIES[character])}"` };
}

// A data file becomes chart text: CSV with a header row, or JSON as an array of objects. Labels come
// from column x and one series from each column in y; a pie takes the first y column as its values.
export function chartFromData(bytes, filePath, { kind, x, y, unit }) {
  let rows;
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/u, '');
  if (/\.json$/iu.test(filePath)) {
    try { rows = JSON.parse(text); } catch { return { error: 'The data file is not valid JSON.' }; }
    if (!Array.isArray(rows) || !rows.every(row => row && typeof row === 'object' && !Array.isArray(row))) return { error: 'JSON chart data must be an array of objects.' };
  } else {
    const parsed = csvRecords(text);
    if (parsed.error) return parsed;
    const [heading, ...records] = parsed.records;
    if (!heading || !records.length) return { error: 'CSV chart data needs a header row and at least one data row.' };
    const header = heading.fields.map(name => name.trim());
    const duplicate = [x, ...y].find(column => header.filter(name => name === column).length > 1);
    if (duplicate !== undefined) return { error: `CSV header repeats selected column ${JSON.stringify(duplicate)}. Give the selected columns distinct names.` };
    const uneven = records.find(record => record.fields.length !== header.length);
    if (uneven) return { error: `CSV line ${uneven.line} has ${uneven.fields.length} fields; the header has ${header.length}. Supply one field per column, quoting commas and line breaks inside a field.` };
    rows = records.map(record => Object.fromEntries(record.fields.map((value, index) => [header[index], value])));
  }
  const columns = new Set(rows.flatMap(row => Object.keys(row)));
  const missing = [x, ...y].find(column => !columns.has(column));
  if (missing) return { error: `The data file has no column "${missing}". Columns: ${[...columns].join(', ')}.` };
  if (rows.length > (kind === 'pie' ? 12 : 60)) return { error: `A ${kind} chart takes at most ${kind === 'pie' ? 12 : 60} rows; this file has ${rows.length}.` };
  // A blank cell is missing data, not zero: Number('') is 0, so blanks are rejected before conversion.
  const blank = value => value === undefined || value === null || String(value).trim() === '';
  const numbers = column => rows.map(row => blank(row[column]) ? NaN : Number(String(row[column]).replace(/,/gu, '')));
  for (const column of y) {
    const bad = numbers(column).findIndex(value => !Number.isFinite(value));
    if (bad < 0) continue;
    if (blank(rows[bad][column])) return { error: `Column "${column}" is empty in data row ${bad + 1}. A blank is missing data, not zero: fill in the value, or leave the row out and say so in the caption.` };
    return { error: `Column "${column}" has a non-numeric value in data row ${bad + 1}: ${rows[bad][column]}.` };
  }
  const labels = rows.map((row, index) => dataLabel(row[x], `Label column ${JSON.stringify(x)}, data row ${index + 1}`));
  const invalidLabel = labels.find(label => label.error);
  if (invalidLabel) return invalidLabel;
  if (kind === 'pie') { const values = numbers(y[0]); return { text: `pie\n${labels.map((label, index) => `  ${label.text} : ${values[index]}`).join('\n')}` }; }
  const series = y.map(column => dataLabel(column, `Series column ${JSON.stringify(column)}`));
  const invalidSeries = series.find(label => label.error);
  if (invalidSeries) return invalidSeries;
  const axis = unit ? dataLabel(unit, 'Chart unit') : null;
  if (axis?.error) return axis;
  return { text: `xychart-beta\n  x-axis [${labels.map(label => label.text).join(', ')}]\n${axis ? `  y-axis ${axis.text}\n` : ''}${y.map((column, index) => `  ${kind} ${series[index].text} [${numbers(column).join(', ')}]`).join('\n')}` };
}
