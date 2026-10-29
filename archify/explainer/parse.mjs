import { createHash } from 'node:crypto';
import { compileExplainerDiagram } from './diagrams.mjs';

const TYPES = new Set(['architecture','workflow','sequence','dataflow','lifecycle','erd','class','tree','timeline','waterfall']);
const ID = /^[A-Za-z][A-Za-z0-9_-]*$/;
const stable = (kind, value) => `${kind}-${createHash('sha256').update(value).digest('hex').slice(0, 12)}`;
const pointerKey = value => String(value).replaceAll('~','~0').replaceAll('/','~1');
const csv = value => value ? value.split(',').map(part => part.trim()).filter(Boolean) : [];
const rowLabel = value => {
  const match = value.match(/^(.*?)\s+\{#([^}\s]+)\}$/u);
  return match ? {label:match[1].trim(),id:match[2]} : {label:value};
};

/** Restricted author syntax; canonical JSON uses the same model and source locations.
 * Failures return document:null and repairable diagnostics; no partial document is delivered.
 * Source-map start/end values are offsets in the original JS string, not byte offsets.
 */
export function parseExplainer(sourceText, { inputPath, output } = {}) {
  if (typeof sourceText !== 'string') throw new TypeError('Explainer input must be a string');
  // The CLI owns the destination directory. Authored meta.output stays portable.
  if (typeof output === 'string') output = output.split(/[\\/]/u).at(-1);
  const sourceMap = Object.create(null);
  const diagnostics = [];
  const format = sourceText.trimStart().startsWith('{') || sourceText.trimStart().startsWith('[') ? 'json' : 'markdown';
  const starts = [0];
  for (let i = 0; i < sourceText.length; i++) if (sourceText[i] === '\n') starts.push(i + 1);
  const lines = sourceText.split('\n').map(line => line.replace(/\r$/, ''));
  function locate(start, end = start) {
    let lo = 0, hi = starts.length;
    while (lo + 1 < hi) { const mid = (lo + hi) >> 1; if (starts[mid] <= start) lo = mid; else hi = mid; }
    return {line:lo + 1,column:start - starts[lo] + 1,start,end};
  }
  function map(pointer, value, descriptor) {
    sourceMap[pointer] = {...descriptor};
    if (Array.isArray(value)) value.forEach((entry,index) => map(`${pointer}/${index}`,entry,descriptor));
    else if (value && typeof value === 'object') Object.entries(value).forEach(([key,entry]) => map(`${pointer}/${pointerKey(key)}`,entry,descriptor));
  }
  function fail(line, component, reason, example, path = '/') {
    diagnostics.push({code:`explainer/parse-${component}`,severity:'error',message:reason,
      subject:{line,column:1,component,path,...(inputPath ? {input:inputPath} : {})},
      evidence:{reason,example},supportedFixes:[`Use the documented syntax, for example: ${example}`]});
  }
  function unsupported(text, line, component) {
    if (/^\s*(?:>{1,}|#{3,}\s|(?:---|\*\*\*|___)\s*$|```|~~~|[-*+]\s+\[[ xX]\])/u.test(text)) fail(line,component,'This Markdown block is outside the restricted author grammar.','## What happens?\nA short paragraph.');
  }
  let document;
  if (format === 'json') {
    try {
      document = JSON.parse(sourceText);
      // Scan the already parsed JSON to preserve exact nested value locations and detect
      // duplicate keys, which JSON.parse silently overwrites. No eval or JSON rewriting.
      let pos = 0;
      const skip = () => { while (/\s/u.test(sourceText[pos] || '') && pos < sourceText.length) pos++; };
      const stringEnd = () => { const start = pos++; while (pos < sourceText.length) { const c = sourceText[pos++]; if (c === '\\') pos++; else if (c === '"') break; } return JSON.parse(sourceText.slice(start,pos)); };
      function scan(pointer) {
        skip(); const start = pos;
        if (sourceText[pos] === '{') {
          pos++; skip(); const keys = new Set();
          while (sourceText[pos] !== '}') {
            skip(); const keyStart = pos; const key = stringEnd();
            if (keys.has(key)) fail(locate(keyStart).line,'json','Duplicate JSON keys would discard authored content.','Use each object key once.',`${pointer}/${pointerKey(key)}`);
            keys.add(key); skip(); pos++; scan(`${pointer}/${pointerKey(key)}`); skip(); if (sourceText[pos] === ',') pos++; else break;
          }
          pos++;
        } else if (sourceText[pos] === '[') {
          pos++; skip(); let index = 0;
          while (sourceText[pos] !== ']') { scan(`${pointer}/${index++}`); skip(); if (sourceText[pos] === ',') pos++; else break; }
          pos++;
        } else if (sourceText[pos] === '"') stringEnd();
        else { while (pos < sourceText.length && !/[\s,\]}]/u.test(sourceText[pos])) pos++; }
        sourceMap[pointer] = locate(start,pos);
      }
      scan('');
      if (document && !Array.isArray(document) && typeof document === 'object') {
        if (document.meta && typeof document.meta === 'object' && output) document.meta.output = output;
      }
    } catch (error) {
      const match = String(error.message).match(/position (\d+)/u);
      const lineMatch = String(error.message).match(/line (\d+)/u);
      fail(match ? locate(Number(match[1])).line : Number(lineMatch?.[1] || 1),'json','Input is not valid JSON.','{"schema_version":1,"diagram_type":"explainer",...}');
    }
  } else {
    document = {schema_version:1,diagram_type:'explainer',meta:{},answer:{summary:''},panels:[],sources:[]};
    let panel = null, panelIndex = -1, titleSeen = false, answerSeen = false, reasonsAllowed = false, cursor = 0;
    const workflowLocales = [];
    const descriptor = (line, endLine = line + 1) => locate(starts[line] ?? sourceText.length, starts[endLine] ?? sourceText.length);
    const closePanel = end => { if (panelIndex >= 0) sourceMap[`/panels/${panelIndex}`].end = end; };
    function heading(line, prefix) {
      const match = line.slice(prefix.length).trim().match(/^(.*?)(?:\s+\{(?:#([^}\s]+))?(?:\s*span=(\d+))?\})?$/su);
      return {title:match[1].trim(),id:match[2],...(match[3]?{span:Number(match[3])}:{})};
    }
    function addBlock(block, at, until, rows = []) {
      if (!panel) { fail(at + 1,block.type,'Blocks must follow a question panel heading.','## What should I know?'); return; }
      // A block named after its own panel points at the same place; keep both reachable instead of failing.
      // Diagrams keep their ID because node and route links name it.
      if (block.id && block.id === panel.id && block.type !== 'diagram') block.id = `${panel.id}-${block.type}`;
      block.id ||= stable(block.type,`${panel.id}\0${JSON.stringify(block)}`);
      if (block.type === 'comparison') {
        const occurrences = new Map();
        for (const row of block.rows) {
          if (row.id) continue;
          const occurrence = occurrences.get(row.label) || 0;
          occurrences.set(row.label, occurrence + 1);
          // Repeated labels still represent separate rows. Keep the first automatic ID
          // unchanged so existing row links and delivered source bindings remain valid.
          const key = `${block.id}\0${row.label}`;
          row.id = stable('row', occurrence ? `${key}\0${occurrence}` : key);
        }
      }
      const pointer = `/panels/${panelIndex}/blocks/${panel.blocks.length}`;
      panel.blocks.push(block); map(pointer,block,descriptor(at,until));
      const property = {facts:'entries',comparison:'rows',steps:'items',list:'items'}[block.type];
      if (property) rows.forEach((row,index) => { if (block[property]?.[index] !== undefined) map(`${pointer}/${property}/${index}`,block[property][index],descriptor(row.line,row.line+1)); });
    }
    function cells(raw, line) {
      const trimmed = raw.trim();
      let value = trimmed.startsWith('|') ? trimmed.slice(1) : trimmed;
      if (value.endsWith('|') && !/(^|[^\\])(\\\\)*\\\|$/u.test(value)) value = value.slice(0,-1);
      const result = []; let cell = '', code = false;
      for (let i = 0; i < value.length; i++) {
        const char = value[i];
        if (char === '\\' && ['|','\\'].includes(value[i+1])) { cell += value[++i]; continue; }
        if (char === '`') code = !code;
        if (char === '|' && !code) { result.push(cell.trim()); cell = ''; } else cell += char;
      }
      result.push(cell.trim());
      if (code) fail(line + 1,'rows','Unclosed inline code in a table row.','| label | `literal` |');
      return result;
    }
    function attributes(raw,line) {
      const attrs = Object.create(null), positional = []; let pos = 0;
      while (pos < raw.length) {
        while (/\s/u.test(raw[pos] || '') && pos < raw.length) pos++;
        if (pos >= raw.length) break;
        const token = raw.slice(pos).match(/^([^\s=]+)(=)?/u);
        if (!token) { fail(line + 1,'directive','Malformed directive arguments.','@metric label="Latency" value=12 unit=ms'); break; }
        const key = token[1]; pos += token[0].length;
        if (!token[2]) { positional.push(key); continue; }
        let value = '';
        if (raw[pos] === '"' || raw[pos] === "'") {
          const quote = raw[pos++]; let closed = false;
          while (pos < raw.length) { const c = raw[pos++]; if (c === quote) { closed = true; break; } if (c === '\\' && [quote,'\\'].includes(raw[pos])) value += raw[pos++]; else value += c; }
          if (!closed) fail(line + 1,'directive','Quoted directive value is not closed.','title="A short title"');
          if (pos < raw.length && !/\s/u.test(raw[pos])) fail(line+1,'directive','Arguments must be separated by whitespace.','label="Latency" value=12');
        } else { const start = pos; while (pos < raw.length && !/\s/u.test(raw[pos])) pos++; value = raw.slice(start,pos); }
        if (Object.hasOwn(attrs,key)) fail(line+1,'directive','Duplicate arguments would discard authored content.','Use each key once.');
        attrs[key] = value;
      }
      return {attrs,positional};
    }
    function rowWidth(rows,min,max,component) {
      for (const row of rows) if (row.cells.length < min || row.cells.length > max) fail(row.line+1,component,`Expected ${min === max ? min : `${min}–${max}`} cells in this directive row.`,`| ${Array.from({length:min},(_,i)=>`field${i+1}`).join(' | ')} |`);
    }
    function boolean(value, at, component) {
      if (value === undefined) return undefined;
      if (!['true','false'].includes(value)) fail(at+1,component,'Boolean arguments require true or false.','multiple=true');
      return value === 'true';
    }
    function number(value, at, component) {
      if (value === undefined) return undefined;
      if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/iu.test(value) || !Number.isFinite(Number(value))) fail(at+1,component,'Numeric arguments require a finite number.','value=12.5');
      return Number(value);
    }
    function select(attrs, keys) { return Object.fromEntries(keys.filter(key => attrs[key] !== undefined).map(key=>[key,attrs[key]])); }
    function directive(at) {
      const match = lines[at].trim().match(/^@([a-z][a-z-]*)(?:\s+(.*))?$/u);
      if (!match) { fail(at+1,'directive','Malformed type directive.','@facts\n| key | value |'); cursor++; return; }
      let type = match[1]; const {attrs:a,positional} = attributes(match[2] || '',at);
      if (TYPES.has(type)) { positional.unshift(type); type='diagram'; }
      cursor = at + 1; const rows=[]; let literal;
      let literalStart;
      if (type === 'diff' && /^```diff\s*$/u.test(lines[cursor]?.trim() || '')) {
        cursor++; const begin=cursor; literalStart=begin; while (cursor<lines.length && lines[cursor].trim()!=='```') cursor++;
        if (cursor===lines.length) fail(at+1,'diff','The diff fence is not closed.','@diff\n```diff\n-old\n+new\n```');
        const end=starts[cursor] ?? sourceText.length;
        literal=sourceText.slice(starts[begin] ?? sourceText.length,end).replace(/\r?\n$/u,''); if (cursor<lines.length) cursor++;
      } else {
        // A directive row never starts with an empty cell; "|| id |" is a line-number prefix copied from a file viewer.
        while (cursor<lines.length && lines[cursor].trim() && !/^(?:#{1,2}\s|@)/u.test(lines[cursor].trim())) { rows.push({cells:cells(lines[cursor].replace(/^(\s*)\|\|(?=\s)/u,'$1|'),cursor),line:cursor}); cursor++; }
        // A callout with no rows takes the plain paragraph that follows it as its text.
        if (type==='callout' && !rows.length && a.text===undefined) {
          let next=cursor; while (next<lines.length && !lines[next].trim()) next++;
          const paragraph=[]; while (next<lines.length && lines[next].trim() && !/^(?:#{1,2}\s|@|\||[-*+]\s|\d+\.\s|```|~~~)/u.test(lines[next].trim())) { paragraph.push({cells:[lines[next].trim()],line:next}); next++; }
          if (paragraph.length) { rows.push(...paragraph); cursor=next; }
        }
      }
      const allowed = {
        source:['title','url','path','lines','revision'],meta:['locale','quality_profile','style','repo_url','repo_revision','repo_provider','repo_link_mode'],answer:['scope','span'],
        prose:['id','text'],list:['id','ordered'],callout:['id','level','title','text'],facts:['id'],metric:['id','label','value','limit','unit','note','typical'],steps:['id'],diagram:['id','source','spec','title','changes'],code:['id','source','language'],diff:['id','caption'],image:['id','path','alt','caption'],comparison:['id','columns','label'],chart:['id','title','type','data','x','y','unit']
      }[type];
      if (!allowed) { fail(at+1,'directive',`Unsupported component @${type}.`,'@facts\n| key | value |'); return; }
      for (const key of Object.keys(a)) if (!allowed.includes(key)) fail(at+1,type,`Unsupported argument ${key}.`,`@${type} ${allowed.map(key=>`${key}=...`).join(' ')}`);
      if (!['source','diagram'].includes(type) && positional.length) fail(at+1,type,'This directive accepts key=value arguments only.',`@${type} id=stable-id`);
      if (['meta','answer'].includes(type) && rows.length) fail(rows[0].line+1,type,'This directive accepts header arguments only.','@meta locale=en quality_profile=showcase');
      if (type==='source') {
        if (positional.length!==1) fail(at+1,type,'Source declarations require an ID.','@source docs title="Documentation" url=https://example.com/docs');
        const source={id:positional[0],...select(a,['title','url','path','revision'])};
        if (a.lines!==undefined) { const range=a.lines.match(/^(\d+):(\d+)$/u); if (!range) fail(at+1,type,'Repository lines require start:end.','lines=10:20'); source.lines=range?[Number(range[1]),Number(range[2])]:[]; }
        if(rows.length) fail(at+1,type,'Source declarations do not accept rows.','@source demo title="Timing model"');
        const pointer=`/sources/${document.sources.length}`;document.sources.push(source);map(pointer,source,descriptor(at,cursor));return;
      }
      if (type==='meta') { Object.assign(document.meta,select(a,['locale','quality_profile','style'])); if(a.repo_url || a.repo_revision) document.meta.repository={url:a.repo_url,revision:a.repo_revision,...(a.repo_provider?{provider:a.repo_provider}:{}),...(a.repo_link_mode?{link_mode:a.repo_link_mode}:{})}; for(const key of ['locale','quality_profile','style','repository'])if(document.meta[key]!==undefined)map(`/meta/${key}`,document.meta[key],descriptor(at,cursor));return; }
      if (type==='answer') { for(const key of ['scope','span'])if(a[key]!==undefined){document.answer[key]=key==='span'?number(a[key],at,type):a[key];sourceMap[`/answer/${key}`]=descriptor(at,cursor);}return; }
      let block={type,...(a.id?{id:a.id}:{})};
      switch(type) {
        case 'prose': rowWidth(rows,1,1,type);block.text=a.text??rows.map(r=>r.cells[0]).join('\n');break;
        case 'list': rowWidth(rows,1,1,type);block.items=rows.map(r=>r.cells[0]);if(a.ordered!==undefined)block.ordered=boolean(a.ordered,at,type);break;
        case 'callout': rowWidth(rows,1,1,type);Object.assign(block,{level:a.level||'note',...select(a,['title']),text:a.text??rows.map(r=>r.cells[0]).join('\n')});break;
        case 'facts':rowWidth(rows,2,2,type);block.entries=rows.map(r=>({key:r.cells[0],value:r.cells[1]}));break;
        case 'metric':Object.assign(block,select(a,['label','unit','note']));for(const key of ['value','limit'])if(a[key]!==undefined)block[key]=number(a[key],at,type);if(a.typical!==undefined)block.typical=boolean(a.typical,at,type);break;
        case 'steps':rowWidth(rows,2,7,type);block.items=rows.map(r=>{let [id,text,detail,diagram,node,route,edges]=r.cells;if(node?.includes('~')&&!route){route=node;node='';}const target=diagram?{diagram,...(node?{node}:{}),...(route?{route:route.split('~')}:{}),...(edges?{edges:csv(edges)}:{})}:undefined;if(!diagram&&(node||route||edges))fail(r.line+1,type,'A step node, route or edge reference needs its diagram ID.','| step | Read cache | | cache-flow | redis | | |');return{id,text,...(detail?{detail}:{}),...(target?{target}:{})};});break;
        case 'diagram': {
          if(positional.length!==1)fail(at+1,type,'A diagram requires exactly one native type.','@diagram sequence source=cache.sequence.json');
          block.diagramType=positional[0];
          if(a.source!==undefined)block.source=a.source;
          if(a.spec!==undefined) { try{block.spec=JSON.parse(a.spec);}catch{fail(at+1,type,'Inline diagram spec must be valid JSON.','@diagram sequence spec=\'{"schema_version":1,...}\'');} }
          if(rows.length&&(a.spec!==undefined||a.source!==undefined))fail(at+1,type,'Choose shorthand rows, spec or source, not several.','@diagram sequence source=cache.sequence.json');
          // Reference cells belong to the page, not to the native diagram spec.
          for (const r of rows) {
            for (let index=r.cells.length-1;index>=1;index--) {
              const ref=r.cells[index].match(/^(source|block):([A-Za-z][\w-]*)$/u);
              if(!ref)continue;
              const node = r.cells[0].replace(/^(?:actor|entity)\s+/u, '').trim();
              const key = ref[1] === 'source' ? 'nodeSources' : 'nodeBlocks';
              const declaration = block.diagramType==='sequence' ? r.cells[0].startsWith('actor ') : block.diagramType==='erd' ? r.cells[0].startsWith('entity ') : true;
              if (!ID.test(node) || !declaration) { fail(r.line+1,type,'A content reference belongs to a node, actor or entity row.','| api | API | backend | block:api-notes |'); continue; }
              if (Object.hasOwn(block[key] || {}, node)) { fail(r.line+1,type,'A node accepts one reference of each kind.','| api | API | backend | block:api-notes |'); continue; }
              (block[key] ||= {})[node] = ref[2];
              (r.references ||= []).push({ key, node });
              r.cells.splice(index,1);
            }
          }
          if(rows.length&&a.spec===undefined&&a.source===undefined)try{
            const input=rows.map(r=>({cells:r.cells,line:r.line+1}));
            const options={id:a.id||stable('diagram',`${panel?.id}\0${JSON.stringify(rows.map(r=>r.cells))}`),title:a.title||panel?.title||document.meta.title,line:at+1,quality:document.meta.quality_profile};
            block.spec=compileExplainerDiagram(block.diagramType,input,options);
            if(block.diagramType==='workflow')workflowLocales.push({block,input,options,pointer:`/panels/${panelIndex}/blocks/${panel?.blocks.length}/spec`});
          }catch(error){const found=error.archifyDiagnostics||error.diagnostics;if(found?.length)diagnostics.push(...found);else fail(at+1,type,'The diagram shorthand could not compile.','@diagram sequence source=cache.sequence.json');}
          if(a.changes!==undefined)block.changes=csv(a.changes).map(value=>{const [target,change]=value.split(':');return{target,change};});break;
        }
        case 'code':Object.assign(block,select(a,['source','language']));break;
        case 'diff':block.text=literal??rows.map(r=>r.cells.join(' | ')).join('\n');Object.assign(block,select(a,['caption']));break;
        case 'image':Object.assign(block,select(a,['path','alt','caption']));break;
        case 'chart':{if(!a.data||!a.x||!a.y)fail(at+1,type,'A data chart names its file, label column and value columns.','@chart type=bar data=latency.csv x=day y=p50,p99');if(a.type!==undefined&&!['bar','line','pie'].includes(a.type))fail(at+1,type,'A data chart is a bar, line or pie chart.','@chart type=line data=latency.csv x=day y=p99');Object.assign(block,select(a,['title']),{data:{path:a.data,kind:a.type||'bar',x:a.x,y:csv(a.y),...(a.unit?{unit:a.unit}:{})}});break;}
        case 'comparison':rowWidth(rows,2,500,type);if(a.label)block.labelColumn=a.label;block.columns=csv(a.columns);block.rows=rows.map(r=>({...rowLabel(r.cells[0]),cells:r.cells.slice(1).map(assessment)}));break;
      }
      if (['metric','code','image','chart'].includes(type)&&rows.length)fail(at+1,type,'This component accepts header arguments only.',`@${type} ${allowed.filter(k=>k!=='id').map(k=>`${k}=...`).join(' ')}`);
      if(type!=='diff')for(const row of rows)for(const text of row.cells)unsupported(text,row.line+1,type);
      addBlock(block,at,cursor,rows);
      if(type==='diagram'&&panel)for(const r of rows)for(const ref of r.references||[])sourceMap[`/panels/${panelIndex}/blocks/${panel.blocks.length-1}/${ref.key}/${pointerKey(ref.node)}`]=descriptor(r.line,r.line+1);
      if(type==='diff'&&panel) {
        const pointer=`/panels/${panelIndex}/blocks/${panel.blocks.length-1}/text`;
        sourceMap[pointer]=literalStart!==undefined?locate(starts[literalStart]??sourceText.length,(starts[literalStart]??sourceText.length)+literal.length):descriptor(rows[0]?.line??at,cursor);
      }
    }
    function assessment(text) {
      // Citations may follow the assessment; they stay with the cell text.
      const match = text.match(/^(.*?)\s*\{(good|caution|bad)(?::([^}]+))?\}((?:\s*\[[^\]]*\]\([^)\s]*\))*)\s*$/u);
      // A cell holding only a badge ({bad:Drop}) shows the badge; its label doubles as the cell text.
      return match?{text:`${match[1].trim()}${match[4].trim()}`||match[3]?.trim()||'',assessment:match[2],...(match[3]?{verdict:match[3].trim()}:{})}:{text};
    }
    while(cursor<lines.length) {
      const at=cursor, trimmed=lines[at].trim();
      if(!trimmed){cursor++;continue;}
      if(trimmed.startsWith('# ')) {
        if(titleSeen||panel)fail(at+1,'heading','Use one document title before all panels.','# What should we choose? {#choice}');
        const h=heading(trimmed,'# ');document.meta.title=h.title;document.meta.id=h.id||stable('explainer',h.title);titleSeen=true;map('/meta',document.meta,descriptor(at));cursor++;continue;
      }
      if(trimmed.startsWith('## ')) {
        closePanel(starts[at]);const h=heading(trimmed,'## ');panel={id:h.id||stable('panel',h.title),title:h.title,...(h.span!==undefined?{span:h.span}:{}),blocks:[]};panelIndex=document.panels.length;document.panels.push(panel);map(`/panels/${panelIndex}`,panel,descriptor(at,lines.length));cursor++;continue;
      }
      if(trimmed.startsWith('@')){reasonsAllowed=false;directive(at);continue;}
      const fence=trimmed.match(/^(```+|~~~+)\s*([A-Za-z0-9_+.#-]*)\s*(.*)$/u);
      if(fence) {
        reasonsAllowed=false;
        const {attrs:fa,positional:fp}=attributes(fence[3]||'',at);
        if(fp.length||Object.keys(fa).some(key=>key!=='title'))fail(at+1,'snippet','A code fence accepts a language and an optional title only.','```bash title="Run the tests"');
        cursor=at+1;const begin=cursor;while(cursor<lines.length&&lines[cursor].trim()!==fence[1])cursor++;
        if(cursor===lines.length)fail(at+1,'snippet','The code fence is not closed.','```bash\nnpm test\n```');
        const from=starts[begin]??sourceText.length,literal=sourceText.slice(from,starts[cursor]??sourceText.length).replace(/\r?\n$/u,'');
        if(cursor<lines.length)cursor++;
        if(!literal.trim()){fail(at+1,'snippet','A code fence needs content.','```bash\nnpm test\n```');continue;}
        const language=fence[2];
        addBlock(language==='diff'?{type:'diff',text:literal,...(fa.title?{caption:fa.title}:{})}:language==='mermaid'?{type:'chart',...(fa.title?{title:fa.title}:{}),text:literal}:{type:'snippet',...(language?{language}:{}),...(fa.title?{title:fa.title}:{}),text:literal},at,cursor);
        if(panel)sourceMap[`/panels/${panelIndex}/blocks/${panel.blocks.length-1}/text`]=locate(from,from+literal.length);
        continue;
      }
      if(trimmed.startsWith('|')) {
        const rows=[];while(cursor<lines.length&&lines[cursor].trim().startsWith('|')){rows.push({cells:cells(lines[cursor],cursor),line:cursor});cursor++;}
        if(rows.length<3||!rows[1].cells.every(cell=>/^:?-{3,}:?$/u.test(cell)))fail(at+1,'comparison','A Markdown table needs a header, separator and data rows.','| Criterion | A | B |\n| --- | --- | --- |\n| Cost | Low {good} | High {bad} |');
        const columns=rows[0]?.cells.slice(1)||[];const data=rows.slice(2);for(const r of data)if(r.cells.length!==columns.length+1)fail(r.line+1,'comparison','All table rows must match the header width.','| Cost | Low {good} | High {bad} |');
        addBlock({type:'comparison',...(rows[0]?.cells[0]?{labelColumn:rows[0].cells[0]}:{}),columns,rows:data.map(r=>({...rowLabel(r.cells[0]),cells:r.cells.slice(1).map(assessment)}))},at,cursor,data);continue;
      }
      const list=trimmed.match(/^(?:([-*+])|(\d+)\.)\s+(.+)$/u);
      if(list) {
        const rows=[];const ordered=Boolean(list[2]);while(cursor<lines.length){const found=lines[cursor].trim().match(/^(?:([-*+])|(\d+)\.)\s+(.+)$/u);if(!found||Boolean(found[2])!==ordered)break;if(/^\s{2,}/u.test(lines[cursor]))fail(cursor+1,'list','Nested lists are unsupported.','- One flat item');unsupported(found[3],cursor+1,'list');rows.push({cells:[found[3]],line:cursor});cursor++;}
        if(!panel){if(!reasonsAllowed||ordered||document.answer.reasons)fail(at+1,'answer','Use one flat unordered reason list after the conclusion.','A conclusion.\n\n- First reason\n- Second reason');document.answer.reasons=rows.map(r=>r.cells[0]);map('/answer/reasons',document.answer.reasons,descriptor(at,cursor));rows.forEach((r,i)=>map(`/answer/reasons/${i}`,r.cells[0],descriptor(r.line)));}else{const task=/^\[[ xX]\]\s+/u,tasks=rows.filter(r=>task.test(r.cells[0])).length;if(tasks&&(ordered||tasks<rows.length))fail(at+1,'list','Write every checklist item as "- [ ] item" in one unordered list.','- [ ] Check the deposit terms\n- [ ] Photograph the meter readings');addBlock({type:'list',ordered,...(tasks?{checklist:true}:{}),items:rows.map(r=>tasks?r.cells[0].replace(task,''):r.cells[0])},at,cursor,rows);}continue;
      }
      const chunks=[];while(cursor<lines.length&&lines[cursor].trim()&&!/^(?:#{1,2}\s|@|\||[-*+]\s|\d+\.\s|```|~~~)/u.test(lines[cursor].trim())){unsupported(lines[cursor],cursor+1,'prose');chunks.push(lines[cursor].trim());cursor++;}
      if(cursor===at){unsupported(trimmed,at+1,'prose');cursor++;continue;}
      const text=chunks.join('\n');
      if(!panel) {
        if(!titleSeen)fail(at+1,'answer','The document title must precede the short answer.','# A title\n\nA direct answer.');
        if(answerSeen)fail(at+1,'answer','The short answer is one paragraph before the panels.','A direct answer in one paragraph.\n\n## Why?');
        document.answer.summary=text;answerSeen=true;reasonsAllowed=true;map('/answer',document.answer,descriptor(at,cursor));
      } else addBlock({type:'prose',text},at,cursor);
    }
    closePanel(sourceText.length);
    // Resolve workflow labels after metadata without changing the original compile
    // options or the automatic block ID already bound to the authored rows.
    for(const {block,input,options,pointer} of workflowLocales)if(typeof document.meta.locale==='string'&&!document.meta.locale.startsWith('zh')){
      block.spec=compileExplainerDiagram('workflow',input,{...options,locale:document.meta.locale});
      if(sourceMap[pointer])map(pointer,block.spec,sourceMap[pointer]);
    }

    if(!titleSeen)fail(1,'title','A document requires one # title.','# What should we choose?');
    if(!answerSeen)fail(1,'answer','A short answer is required before question panels.','# A title\n\nA direct answer.\n\n## Why?');
    if(!document.panels.length)fail(1,'panel','At least one question panel is required.','## Why does this happen?');
    if(output)document.meta.output=output;
  }
  const identities=new Map();
  function identity(value,pointer,component) {
    if(typeof value!=='string')return;
    const line=sourceMap[pointer]?.line||sourceMap[pointer.replace(/\/id$/u,'')]?.line||1;
    if(!ID.test(value)||value.length>100)fail(line,component,'IDs must begin with an ASCII letter and contain letters, numbers, hyphens or underscores.','id=cache-flow',pointer);
    const previous=identities.get(value);
    if(previous)fail(line,component,`Duplicate ID "${value}": the ${previous.component} on line ${previous.line} already uses it. Panels, blocks, diagrams and steps share one ID namespace.`,component==='panel'?`## Another question? {#${value}-2}`:`omit id=, or use id=${value}-${component}`,pointer);
    identities.set(value,{pointer,component,line});
  }
  if(document&&typeof document==='object'&&!Array.isArray(document)) {
    identity(document.meta?.id,'/meta/id','document');
    for(const [pi,p]of (Array.isArray(document.panels)?document.panels:[]).entries()) {
      identity(p?.id,`/panels/${pi}/id`,'panel');
      for(const [bi,b]of (Array.isArray(p?.blocks)?p.blocks:[]).entries())identity(b?.id,`/panels/${pi}/blocks/${bi}/id`,b?.type||'block');
    }
  }
  return {document:diagnostics.some(d=>d.severity==='error')?null:document,sourceMap,format,sourceText,diagnostics};
}
