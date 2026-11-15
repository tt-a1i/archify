/** The explainer's deliberately small inline language; never an HTML escape hatch. */
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const identifier = /^[\p{L}\p{N}_-]+$/u;
const targetIdentifier = /^[\p{L}\p{N}_.:-]+$/u;

function referenceFor(href) {
  if (/^https?:\/\//i.test(href)) {
    try {
      const url = new URL(href);
      if (url.username || url.password || /[\u0000-\u0020\u007f]/u.test(href)) return null;
      return {kind:'web',url:href};
    } catch { return null; }
  }
  if (href.startsWith('source:') && identifier.test(href.slice(7))) return {kind:'source',id:href.slice(7)};
  if (href.startsWith('block:') && identifier.test(href.slice(6))) return {kind:'block',id:href.slice(6)};
  if (href.startsWith('#') && identifier.test(href.slice(1))) return {kind:'block',id:href.slice(1)};
  if (href.startsWith('typical:') && href.slice(8).trim()) return {kind:'typical',text:href.slice(8).trim()};
  if (href.startsWith('node:') || href.startsWith('route:')) {
    const kind = href.startsWith('node:') ? 'node' : 'route';
    const value = href.slice(kind.length + 1);
    const split = value.indexOf('.');
    if (split < 1 || !identifier.test(value.slice(0,split))) return null;
    const diagram = value.slice(0,split), target = value.slice(split+1);
    if (kind === 'node' && targetIdentifier.test(target)) return {kind,diagram,node:target};
    const route = target.split('~');
    if (kind === 'route' && route.length === 2 && route.every(id => targetIdentifier.test(id))) return {kind,diagram,from:route[0],to:route[1]};
  }
  return null;
}

/** Returns tokens and references, with offsets for validation and actionable diagnostics. */
export function parseInline(value, options = {}) {
  const text = String(value ?? '');
  const references = [], diagnostics = [];
  function problem(code, index, reason, example) {
    const before = text.slice(0,index), lastBreak = before.lastIndexOf('\n');
    diagnostics.push({code:`explainer/inline-${code}`,severity:'error',message:reason,
      subject:{line:(Number.isInteger(options.line) ? options.line : 1) + (before.match(/\n/g)?.length || 0),column:index-lastBreak,
        component:options.component || 'inline',...(options.panelId ? {panelId:options.panelId} : {}),...(options.input ? {input:options.input} : {})},
      evidence:{reason,example},supportedFixes:[`Use the supported form: ${example}`]});
  }
  function segment(start, end, depth = 0) {
    const tokens = [];
    const literal = value => {
      if (!value) return;
      const previous = tokens[tokens.length-1];
      if (previous?.type === 'text') previous.value += value;
      else tokens.push({type:'text',value});
    };
    for (let i=start;i<end;) {
      const c=text[i];
      if (c === '\\' && i+1 < end && /[\\`*_[\]()!<>~|]/u.test(text[i+1])) { literal(text[i+1]);i+=2;continue; }
      if (c === '`') {
        const close=text.indexOf('`',i+1);
        if (close === -1 || close >= end || text.slice(i+1,close).includes('\n')) {
          problem('code',i,'Inline code must have one closing backtick on the same line.','`cache.get(key)`');literal(c);i++;continue;
        }
        tokens.push({type:'code',value:text.slice(i+1,close)});i=close+1;continue;
      }
      if (c === '<' && /^(?:<\/?[A-Za-z][^>]*>|<!--)/u.test(text.slice(i,end))) {
        problem('html',i,'Raw HTML is not part of the explainer inline language.','**Important** or `[literal <tag>]`');
        literal(c);i++;continue;
      }
      if (text.startsWith('![',i)) {
        problem('image',i,'Inline Markdown images are unsupported. Use a contained image block.','@image path=diagram.png alt="Request path"');
        literal('!');i++;continue;
      }
      if (text.startsWith('~~',i)) { problem('decoration',i,'Strikethrough is unsupported; use a diff or an explicit change block.','Changed: **new behavior**');literal('~~');i+=2;continue; }
      if (c === '*') {
        const marker=text.startsWith('**',i) ? '**' : '*';
        let close=text.indexOf(marker,i+marker.length);
        const escaped = index => {
          let slashes=0;
          while (index > start && text[--index] === '\\') slashes++;
          return slashes % 2 === 1;
        };
        while (close > -1 && escaped(close)) close=text.indexOf(marker,close+marker.length);
        if (close < 0 || close >= end || close === i+marker.length || depth >= 6) {
          problem('emphasis',i,'Emphasis needs matching nonempty delimiters. Escape a literal asterisk.','**important** or \\*');literal(marker);i+=marker.length;continue;
        }
        tokens.push({type:marker.length===2?'strong':'em',children:segment(i+marker.length,close,depth+1)});i=close+marker.length;continue;
      }
      if (c === '[') {
        const labelEnd=text.indexOf(']',i+1);
        if (labelEnd > -1 && labelEnd < end && text[labelEnd+1] === '(') {
          let close=labelEnd+2, nesting=1;
          for (;close<end;close++) {
            if (text[close] === '\\') { close++;continue; }
            if (text[close] === '(') nesting++;
            if (text[close] === ')' && --nesting === 0) break;
          }
          if (close >= end || nesting !== 0) {
            problem('link',i,'The link destination is not closed.','[Evidence](source:cache-read)');literal(c);i++;continue;
          }
          const label=text.slice(i+1,labelEnd), href=text.slice(labelEnd+2,close).replace(/\\([()\\])/g,'$1');
          const reference=referenceFor(href);
          if ((!label.trim() && reference?.kind !== 'source') || !reference) {
            problem('target',i,'Use a nonempty label and an HTTP(S), source, block, node, route or typical destination.','[Redis](node:read-path.redis)');
            literal(text.slice(i,close+1));
          } else {
            const entry={...reference,offset:i,end:close+1};references.push(entry);
            tokens.push({type:'link',label,href,reference:entry});
          }
          i=close+1;continue;
        }
        if (text[i+1] === '^') problem('footnote',i,'Arbitrary Markdown footnotes are unsupported. Use a source or typical-value reference.','[Claim](source:trace)');
      }
      literal(c);i++;
    }
    return tokens;
  }
  const tokens=segment(0,text.length);
  return {tokens,references,diagnostics};
}

function inlineError(diagnostics) {
  const error=new Error(diagnostics[0].message);
  error.archifyDiagnostics=diagnostics;
  error.diagnostics=diagnostics;
  return error;
}

/** Safely render the same parsed language used by semantic validation. */
export function renderInline(value, context = {}) {
  const parsed=parseInline(value,context);
  if (parsed.diagnostics.length) throw inlineError(parsed.diagnostics);
  const render = tokens => tokens.map(token => {
    if (token.type === 'text') return escapeHtml(token.value);
    if (token.type === 'code') return `<code>${escapeHtml(token.value)}</code>`;
    if (token.type === 'strong' || token.type === 'em') return `<${token.type}>${render(token.children)}</${token.type}>`;
    const label=escapeHtml(token.label), ref=token.reference;
    if (ref.kind === 'web') return `<a href="${escapeHtml(ref.url)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    if (ref.kind === 'source') {
      const citations = context.citations || (context.citations = new Map());
      if (!citations.has(ref.id)) citations.set(ref.id,citations.size + 1);
      return `${label}<sup class="cite"><a href="#source-${escapeHtml(ref.id)}">${citations.get(ref.id)}</a></sup>`;
    }
    if (ref.kind === 'block') return `<a href="#${escapeHtml(ref.id)}" data-block-ref="${escapeHtml(ref.id)}">${label}</a>`;
    if (ref.kind === 'node' || ref.kind === 'route') {
      const hash=ref.kind==='node' ? `focus=${encodeURIComponent(ref.node)}` : `route=${encodeURIComponent(ref.from)}~${encodeURIComponent(ref.to)}`;
      return `<a class="diagram-link" href="#${escapeHtml(ref.diagram)}" data-diagram-link="${escapeHtml(ref.diagram)}" data-diagram-hash="${escapeHtml(hash)}">${label}</a>`;
    }
    if (ref.kind === 'typical') {
      if (Array.isArray(context.footnotes)) {
        const index=context.footnotes.length+1,id=`explainer-typical-${index}`;
        context.footnotes.push({id,index,text:ref.text,label:token.label});
        return `<span class="typical" title="${escapeHtml(ref.text)}">${label}<sup><a href="#${id}" role="doc-noteref" class="typical-ref">[${index}]</a></sup></span>`;
      }
      return `<span class="typical">${label}<small class="typical-note"> (${escapeHtml(ref.text)})</small></span>`;
    }
    return label;
  }).join('');
  return render(parsed.tokens);
}
