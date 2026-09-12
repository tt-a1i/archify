import vm from 'node:vm';

export function extractAssignedIife(html, assignName) {
  const start = html.indexOf(`${assignName} = (function () {`);
  if (start < 0) throw new Error(`${assignName} IIFE not found`);
  let i = html.indexOf('{', start);
  let depth = 0;
  let quote = null;
  for (; i < html.length; i += 1) {
    const ch = html[i];
    const prev = html[i - 1];
    if (quote) {
      if (ch === quote && prev !== '\\') quote = null;
      continue;
    }
    if (ch === '\'' || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        const rest = html.slice(i + 1);
        const end = rest.match(/^\s*\)\s*\(\s*\)\s*;/);
        if (!end) throw new Error(`${assignName} IIFE is missing its terminator`);
        return html.slice(start, i + 1 + end[0].length);
      }
    }
  }
  throw new Error(`${assignName} IIFE is unclosed`);
}

function extractI18nData(html) {
  const match = html.match(/<script id="archify-i18n-data" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) return { locale: 'en', messages: {} };
  return JSON.parse(match[1]);
}

function makeViewerText(data) {
  return function viewerText(key, values) {
    const messages = data.messages || {};
    const template = Object.prototype.hasOwnProperty.call(messages, key) ? messages[key] : key;
    return String(template).replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name) => (
      values && Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : match
    ));
  };
}

export function loadDrilldownRuntime(html) {
  const script = extractAssignedIife(html, 'Archify.drilldown');
  const context = { Archify: {}, viewerText: makeViewerText(extractI18nData(html)) };
  vm.createContext(context);
  new vm.Script(script).runInContext(context);
  if (!context.Archify.drilldown) throw new Error('Archify.drilldown was not installed');
  return context.Archify.drilldown;
}

export function createDocumentStub() {
  function create(name, text = '') {
    return {
      nodeName: name,
      innerHTML: '',
      childNodes: [],
      _text: text,
      get textContent() {
        if (this.childNodes.length) return this.childNodes.map((child) => child.textContent).join('');
        return this._text;
      },
      set textContent(value) {
        this._text = String(value);
        this.childNodes = [];
      },
      appendChild(child) {
        this.childNodes.push(child);
        return child;
      },
    };
  }
  return {
    createElement(name) { return create(String(name).toUpperCase()); },
    createTextNode(text) { return create('#text', String(text)); },
  };
}

export function collectedText(node) {
  return node ? node.textContent : '';
}
