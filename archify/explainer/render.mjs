import fs from 'node:fs';
import { softwareNoticesHtml } from '../renderers/shared/software-notices.mjs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseInline, renderInline } from './inline.mjs';
import { parseExplainerDiff } from './diff.mjs';
import { computeExplainerRevision } from './revision.mjs';
import { layoutExplainerPanels } from './layout.mjs';
import { compileExplainerChart } from './charts.mjs';
import { packPageBundle } from './page-bundle.mjs';

const css = fs.readFileSync(new URL('./reader.css', import.meta.url), 'utf8');
const js = fs.readFileSync(new URL('./reader.js', import.meta.url), 'utf8');
const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const json = value => JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
const hash = text => createHash('sha256').update(text).digest('hex');
// Toolbar glyphs, drawn with currentColor so they follow the theme.
const icon = path => `<svg class="tool-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="${path}"/></svg>`;
const icons = {
  chevron: icon('M4.5 6.5 8 10l3.5-3.5'),
  check: icon('M3.5 8.5 6.5 11.5 12.5 4.5'),
  image: icon('M2.5 3.5h11v9h-11zM2.5 10.5l3-3 3 3 2-2 3 3M10.5 6.25a.75.75 0 1 0 0 .01'),
  print: icon('M4.5 6V2.5h7V6M4.5 11.5h-2v-5h11v5h-2M4.5 9.5h7v4h-7z'),
  expand: icon('M9.5 2.5h4v4M13.5 2.5 9.5 6.5M6.5 13.5h-4v-4M2.5 13.5l4-4'),
  close: icon('M4 4l8 8M12 4l-8 8'),
  export: icon('M8 2.5v7M5 6.5l3 3 3-3M3 11v2.5h10V11'),
};
// The Archify symbol (docs/assets/archify-mark.svg), for the favicon and the colophon.
const mark = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 360" fill="none"><path d="M151 94 81 164C67 178 60 191 60 212V248H97V212C97 204 100 199 106 193L179 120Z" fill="#0856F5"/><path d="M238 135C252 132 261 126 270 116L321 167C334 180 339 194 339 213V248H303V213C303 204 300 199 294 193Z" fill="#1DBBB7"/><rect x="146" y="16" width="110" height="104" rx="30" fill="#0856F5"/><rect x="18" y="238" width="110" height="104" rx="28" fill="#0856F5"/><rect x="274" y="238" width="108" height="104" rx="28" fill="#1DBBB7"/></svg>';
const favicon = `data:image/svg+xml,${encodeURIComponent(mark)}`;
const dictionaries = {
  en:{answer:'Answer',answerMark:'A',scope:'Applies to',sources:'Sources',print:'Print / PDF',image:'Long image',imageHints:['Sharpest','Smallest','Opens anywhere'],export:'Export',style:'Style',styles:{clean:'Clean',editorial:'Editorial',product:'Product',swiss:'Swiss'},auto:'System',light:'Light',dark:'Dark',typical:'Typical value',explore:'Open interactive view',exploreTitle:'Zoom, find nodes, trace paths, upstream and downstream, export images or motion',close:'Close',loading:'Opening diagram…',graph:'Diagram structure',changes:'Structure changes',added:'Added',removed:'Removed',modified:'Modified',copy:'Copy',copied:'Copied',walk:'Step through',walkMessages:'Play messages',walkFlow:'Walk the flow',prev:'Back',next:'Next',end:'Done',ask:'Ask',askQuote:'Ask about this',askPlaceholder:'What is unclear, or what should this part cover?',askCopy:'Copy question',askCopied:'Copied. Paste it to your agent.',askCancel:'Cancel',askChips:['I do not follow this part','Go deeper','Give an example','What is this based on?'],askPage:'Page',askFile:'File',askWhere:'Where',askQuoteLabel:'Quote',askQuestion:'Question',askNote:'Copies the page, the panel and its ID, so your agent can revise just this part.',askPatch:'Revise only this panel with Archify panel replacement (patch explainer), keeping its ID.',tagline:'Turn anything you want to understand, plan, or share into an interactive visual.',facts:{panels:n=>`${n} ${n === 1 ? 'panel' : 'panels'}`,diagrams:n=>`${n} ${n === 1 ? 'diagram' : 'diagrams'} validated`,sources:n=>`${n} ${n === 1 ? 'source' : 'sources'}`,pinned:rev=>`code pinned to ${rev}`}},
  zh:{answer:'结论',answerMark:'答',scope:'适用于',sources:'来源',print:'打印 / PDF',image:'长图',imageHints:['最清晰','体积最小','兼容最好'],export:'导出',style:'样式',styles:{clean:'简洁',editorial:'杂志',product:'产品',swiss:'网格'},auto:'系统',light:'浅色',dark:'深色',typical:'典型值',explore:'打开交互图',exploreTitle:'缩放、搜索节点、追踪路径和上下游，导出图片或动画',close:'关闭',loading:'正在打开交互图…',graph:'图的结构',changes:'结构改动',added:'新增',removed:'删除',modified:'修改',copy:'复制',copied:'已复制',walk:'逐步看',walkMessages:'逐条看消息',walkFlow:'沿流程看',prev:'上一步',next:'下一步',end:'结束',ask:'追问',askQuote:'追问这段',askPlaceholder:'哪里没看懂，或者希望这块补充什么？',askCopy:'复制追问',askCopied:'已复制，粘贴给 agent 即可',askCancel:'取消',askChips:['没看懂这块','展开讲讲','举个例子','依据是什么？'],askPage:'页面',askFile:'文件',askWhere:'位置',askQuoteLabel:'引用',askQuestion:'问题',askNote:'会一并复制页面、面板位置和 ID，agent 可以只改这一块。',askPatch:'请用 Archify 的面板替换（patch explainer）只更新这个面板，保留它的 ID。',tagline:'把你想理解、规划或分享的事，变成可以互动的可视化作品。',facts:{panels:n=>`${n} 个面板`,diagrams:n=>`${n} 张图已通过结构校验`,sources:n=>`${n} 个来源`,pinned:rev=>`代码固定在提交 ${rev}`}}
};

/** Render a validated canonical explainer with separately prepared, immutable resources. */
export function renderExplainer(document, options = {}) {
  const { preparedBundle, sourceText = JSON.stringify(document), sourceMap = {}, sourcePath, preparedSources = {}, preparedDiagrams = {}, diagnostics = [], pageDirectory } = options;
  const locale = document.meta.locale || 'zh-CN';
  // Chinese pages get Chinese controls; every other language gets the English ones.
  const english = !locale.startsWith('zh');
  const words = dictionaries[english ? 'en' : 'zh'];
  const sources = preparedSources.sources || preparedSources;
  const assets = preparedSources.assets || {};
  const diagrams = preparedDiagrams.diagrams || preparedDiagrams;
  const sourceSha256 = hash(sourceText);
  const revision = computeExplainerRevision({document,sourceText,preparedSources,preparedDiagrams,dependencies:preparedBundle?.dependencies});
  const footnotes = [];
  const citations = new Map();
  const inline = (text, panelId, blockId) => renderInline(String(text ?? ''), {document,sources,diagrams,panelId,blockId,footnotes,citations});
  function unavailable(block, message) {
    const panelIndex = document.panels.findIndex(panel => panel.blocks.includes(block));
    const pointer = `/panels/${panelIndex}/blocks/${document.panels[panelIndex]?.blocks.indexOf(block)}`;
    const diagnostic = {code:'explainer/render-resource',severity:'error',message,subject:{component:block.type,path:pointer,input:sourcePath,...sourceMap[pointer]},evidence:{reason:message,example:'Prepare Git excerpts and native diagrams before rendering.'},supportedFixes:[]};
    throw Object.assign(new Error(message), {code:diagnostic.code,diagnostics:[diagnostic],archifyDiagnostics:[diagnostic]});
  }
  const nativeLink = (target, text) => {
    const nativeHash = target.node ? `focus=${encodeURIComponent(target.node)}` : target.route ? `route=${encodeURIComponent(target.route[0])}~${encodeURIComponent(target.route[1])}` : '';
    return `<a class="diagram-link" href="#${escape(target.diagram)}" data-diagram-link="${escape(target.diagram)}" data-diagram-hash="${escape(nativeHash)}"${target.edges ? ` data-diagram-edges="${escape(JSON.stringify(target.edges))}"` : ''}>${text}<span aria-hidden="true"> ↗</span></a>`;
  };
  function blockHtml(block, panelId) {
    const i = text => inline(text,panelId,block.id);
    let body;
    switch (block.type) {
      case 'prose': body = block.text.split(/\n\s*\n/).map(text => `<p>${i(text)}</p>`).join(''); break;
      case 'list': { const tag = block.ordered ? 'ol' : 'ul'; if (block.checklist) { body = `<ul class="checklist">${block.items.map(text => `<li><label><input type="checkbox"><span>${i(text)}</span></label></li>`).join('')}</ul>`; break; } body = `<${tag} class="text-list">${block.items.map(text => `<li>${i(text)}</li>`).join('')}</${tag}>`; break; }
      case 'callout': body = `<aside class="callout ${escape(block.level)}">${block.title ? `<h3>${i(block.title)}</h3>` : ''}<p>${i(block.text)}</p></aside>`; break;
      case 'comparison': body = `<div class="table-scroll"><table><thead><tr><th scope="col">${block.labelColumn ? i(block.labelColumn) : ''}</th>${block.columns.map(text => `<th scope="col">${i(text)}</th>`).join('')}</tr></thead><tbody>${block.rows.map(row => `<tr id="${escape(row.id)}"><th scope="row">${i(row.label)}</th>${row.cells.map(cell => `<td>${cell.assessment ? `<span class="assessment ${escape(cell.assessment)}"><span class="assessment-meter" aria-hidden="true"><i></i><i></i><i></i></span><b>${i(cell.verdict || ({good:english?'Favorable':'有利',caution:english?'Tradeoff':'有代价',bad:english?'Unfavorable':'不利'}[cell.assessment]))}</b></span>` : ''}${cell.assessment && cell.text === cell.verdict ? '' : `<span class="cell-text">${i(cell.text)}</span>`}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`; break;
      case 'facts': body = `<dl class="facts">${block.entries.map(entry => `<div><dt>${i(entry.key)}</dt><dd>${i(entry.value)}</dd></div>`).join('')}</dl>`; break;
      case 'metric': {
        const over = block.value !== undefined && block.limit !== undefined && block.value > block.limit;
        const unit = escape(block.unit || '');
        body = `<div class="metric${over ? ' metric-over-limit' : ''}" data-metric-status="${over ? 'over-limit' : block.value === undefined ? 'limit-only' : 'within-limit'}"><span class="metric-label">${i(block.label)}</span><p class="metric-value">${block.value === undefined ? `${english?'Limit':'上限'} ${escape(block.limit)}<span>${unit}</span>` : `${escape(block.value)}${block.unit ? `<span>${unit}</span>` : ''}${block.limit === undefined ? '' : `<small> / ${escape(block.limit)}${unit}</small>`}`}</p>${block.value !== undefined && block.limit > 0 ? `<meter min="0" max="${escape(block.limit)}" value="${escape(Math.max(0, Math.min(block.value,block.limit)))}" aria-label="${escape(block.label)}">${escape(block.value)} / ${escape(block.limit)}</meter>` : ''}${over ? `<p class="metric-overflow">${english?'Over limit by':'超限'} ${escape(block.value - block.limit)}${block.unit ? ` ${unit}` : ''}</p>` : ''}${block.typical ? `<span class="typical">${words.typical}</span>` : ''}${block.note ? `<p class="fine">${i(block.note)}</p>` : ''}</div>`;
        break;
      }
      case 'steps': body = `<ol class="steps">${block.items.map(item => `<li id="${escape(item.id)}"><b>${item.target ? nativeLink(item.target,i(item.text)) : i(item.text)}</b>${item.detail ? `<p>${i(item.detail)}</p>` : ''}</li>`).join('')}</ol>`; break;
      case 'diagram': { const diagram = diagrams[block.id]; if (!diagram?.svg || !diagram?.html) unavailable(block,`Missing prepared native diagram: ${block.id}`); const title = diagram.spec?.meta?.title || block.id; const svg = staticSvg(diagram.svg, block.id); const previewClass = previewPrefix(block.id); const nativeStyle = scopeNativeCss(diagram.styles ?? nativeStyles(diagram.html), '.' + previewClass, previewClass + '-', diagram.svg); const nativeWidth = Number(diagram.svg.match(/viewBox=["'][^"']*?[\d.-]+[ ,]+[\d.-]+[ ,]+([\d.]+)/)?.[1]); const lanes = diagram.previewLanes ?? diagram.spec?.lanes ?? [], singleLane = lanes.length === 1 ? ' single-lane bare-lanes' : lanes.length && lanes.every(lane => /^lane-\d+$/.test(lane.id)) ? ' bare-lanes' : ''; body = `<figure class="diagram"><figcaption><span class="diagram-title">${escape(title)}</span><span class="diagram-actions interactive"><button class="tool-button explore-button" type="button" data-open-diagram="${escape(block.id)}" title="${words.exploreTitle}">${icons.expand}<span>${words.explore}</span></button></span></figcaption><div class="diagram-preview ${previewClass}${singleLane}" role="img" aria-label="${escape(title)}"${block.nodeSources ? ` data-node-sources="${escape(JSON.stringify(block.nodeSources))}"` : ''}${block.nodeBlocks ? ` data-node-blocks="${escape(JSON.stringify(block.nodeBlocks))}"` : ''}${nativeWidth > 0 ? ` style="--native-width:${Math.round(nativeWidth)}px"` : ''}><style>${nativeStyle}</style>${svg}</div></figure><p class="diagram-fit-status fine" role="status" hidden></p><details class="diagram-semantics" open><summary>${words.graph}</summary><ul>${(diagram.semantic?.nodes || []).map(node => `<li>${escape(node.label || node.id)} <code>${escape(node.id)}</code></li>`).join('')}${(diagram.semantic?.edges || []).map(edge => `<li><code>${escape(edge.from)}</code> → <code>${escape(edge.to)}</code>${edge.label ? ` · ${escape(edge.label)}` : ''}</li>`).join('')}</ul></details>${block.changes?.length ? `<dl class="changes"><dt>${words.changes}</dt>${block.changes.map(change => `<dd><span class="chip ${escape(change.change)}">${words[change.change]}</span> <code>${escape(change.target)}</code></dd>`).join('')}</dl>` : ''}`; break; }
      case 'chart': { const text = block.text ?? preparedSources.charts?.[block.id]; if (typeof text !== 'string') unavailable(block,`Missing prepared chart data: ${block.id}`); const chart = compileExplainerChart(text); if (chart.error) unavailable(block, chart.error); body = `<figure class="chart" style="--native-width:${Math.round(chart.width)}px">${chart.svg.replace(/^<svg\b[^>]*>/, tag => tag.replace(/\s(?:width|height)="[^"]*"/g, ''))}${block.title ? `<figcaption>${i(block.title)}</figcaption>` : ''}</figure>`; break; }
      case 'snippet': body = `<figure class="snippet"><figcaption><span class="snippet-label">${block.title ? i(block.title) : ''}${block.language ? `<code class="snippet-language">${escape(block.language)}</code>` : ''}</span><button class="text-button interactive" type="button" data-copy>${words.copy}</button></figcaption><pre><code${block.language ? ` class="language-${escape(block.language)}"` : ''}>${escape(block.text)}</code></pre></figure>`; break;
      case 'code': { const source = sources[block.source]; if (!source?.path || typeof source.text !== 'string') unavailable(block,`Code requires a Git excerpt: ${block.source}`); body = `<figure class="code"><figcaption>${i(`[](source:${block.source})`)}<span>${escape(source.path)}:${escape(source.lines?.join('–'))}</span></figcaption><pre><code${block.language ? ` class="language-${escape(block.language)}"` : ''}>${escape(source.text)}</code></pre></figure>`; break; }
      case 'diff': {
        const parsed = parseExplainerDiff(block.text,{component:'diff',input:sourcePath,panelId});
        if(parsed.diagnostics.some(diagnostic=>diagnostic.severity === 'error')) throw Object.assign(new Error(`Malformed diff: ${block.id}`),{diagnostics:parsed.diagnostics,archifyDiagnostics:parsed.diagnostics});
        body = `<figure class="diff" data-diff-format="${parsed.format}"><figcaption>${block.caption ? `<span>${i(block.caption)}</span>` : ''}<span class="diff-summary"><span class="added">+${parsed.counts.added} ${words.added}</span> · <span class="removed">−${parsed.counts.removed} ${words.removed}</span></span></figcaption><div class="diff-scroll"><table class="diff-code" aria-label="${escape(block.caption || (english?'Code changes':'代码改动'))}"><thead><tr><th scope="col">${english?'Old':'原行'}</th><th scope="col">${english?'New':'新行'}</th><th scope="col">${english?'Change':'改动'}</th></tr></thead><tbody>${parsed.rows.map(row=>`<tr class="diff-line ${escape(row.kind)}" data-diff-kind="${escape(row.kind)}"${row.oldLine === null ? '' : ` data-old-line="${row.oldLine}"`}${row.newLine === null ? '' : ` data-new-line="${row.newLine}"`}><td class="diff-number">${row.oldLine ?? ''}</td><td class="diff-number">${row.newLine ?? ''}</td><td><code>${escape(row.raw)}</code></td></tr>`).join('')}</tbody></table></div></figure>`;
        break;
      }
      case 'image': { const asset = assets[block.id]; if (!asset?.dataUrl || !/^data:image\/(png|jpeg|webp|gif);base64,/.test(asset.dataUrl)) unavailable(block,`Missing contained image: ${block.id}`); body = `<figure class="image"><img src="${escape(asset.dataUrl)}" alt="${escape(block.alt)}">${block.caption ? `<figcaption>${i(block.caption)}</figcaption>` : ''}</figure>`; break; }
      default: throw new Error(`Unsupported explainer block: ${block.type}`);
    }
    return `<div class="block block-${escape(block.type)}" id="${escape(block.id)}" data-block-type="${escape(block.type)}">${body}</div>`;
  }
  const scopeHtml = scope => { const parts = scopeParts(scope); return parts.length > 1 ? parts.map(part=>`<span class="scope-chip">${inline(part)}</span>`).join('') : `<span>${inline(scope)}</span>`; };
  // Render in reading order so the first citation receives number one.
  const titleHtml = inline(document.meta.title);
  const plain = tokens => tokens.map(token => token.children ? plain(token.children) : token.type === 'link' ? token.label : token.value || '').join('');
  const titleText = plain(parseInline(document.meta.title).tokens);
  const answerHtml = `<header class="panel-head"><span class="panel-id answer-id" aria-hidden="true">${words.answerMark}</span><h2>${words.answer}</h2></header><div class="panel-body"><p class="verdict">${inline(document.answer.summary)}</p>${document.answer.reasons?.length ? `<ol class="reasons">${document.answer.reasons.map(reason=>`<li>${inline(reason)}</li>`).join('')}</ol>` : ''}</div>${document.answer.scope ? `<p class="answer-scope"><span class="scope-label">${words.scope}</span>${scopeHtml(document.answer.scope)}</p>` : ''}`;
  const rows=layoutExplainerPanels(document,diagrams);
  const panels=rows.flatMap((row,rowIndex)=>row.map(item=>{
    if(item.spacer)return `<div class="board-spacer span${item.span}" data-row="${rowIndex}" aria-hidden="true"></div>`;
    if(item.answer)return `<section id="answer" class="panel answer-panel span${item.span}" data-row="${rowIndex}" data-span-min="${item.min}">${answerHtml}</section>`;
    const panel=item.panel,index=document.panels.indexOf(panel);
    const measure=panel.blocks.every(block=>['prose','list','steps','callout','facts','metric'].includes(block.type)) ? ' data-measure="text"' : '';
    const blocks=panel.blocks.map(block=>blockHtml(block,panel.id)), figures=panel.blocks.filter(block=>block.type === 'diagram');
    // Steps that point into the panel's one diagram are read beside it: text left, diagram right.
    const guided=figures.length === 1 && panel.blocks.some(block=>block.type === 'steps' && block.items.some(step=>step.target?.diagram === figures[0].id));
    const body=guided ? `<div class="panel-body guided"><div class="guide-figure">${blocks[panel.blocks.indexOf(figures[0])]}</div><div class="guide-text">${blocks.filter((_,n)=>panel.blocks[n] !== figures[0]).join('')}</div></div>` : `<div class="panel-body">${blocks.join('')}</div>`;
    return `<section class="panel span${item.span}${figures.length ? ' diagram-panel' : ''}" id="${escape(panel.id)}" data-row="${rowIndex}" data-span-min="${item.min}"${item.explicit ? ` data-span-fixed="${item.span}"` : ''}${measure} data-title="${escape(panel.title)}"><header class="panel-head"><a class="panel-id" href="#${escape(panel.id)}" aria-label="${escape(panel.title)}">${index+1}</a><h2>${inline(panel.title,panel.id)}</h2></header>${body}</section>`;
  })).join('');
  for(const source of document.sources)if(!citations.has(source.id))citations.set(source.id,citations.size+1);
  const sourceList=[...citations].map(([id,number])=>{
    const source=sources[id] || document.sources.find(source=>source.id===id);
    const location=source?.path ? `<code>${escape(source.path)}${source.lines?':'+escape(source.lines.join('–')):''}${source.revision?' @ '+escape(source.revision):''}</code>` : '';
    const title=source?.url ? `<a href="${escape(source.url)}" target="_blank" rel="noopener noreferrer">${escape(source.title)}</a>` : escape(source?.title || id);
    return `<li id="source-${escape(id)}" value="${number}">${title}${location}</li>`;
  }).join('');
  for (const [id,diagram] of Object.entries(diagrams)) { if (diagram.sha256 && diagram.sha256 !== hash(diagram.html)) throw new Error(`Native child hash mismatch: ${id}`); if (diagram.bytes !== undefined && diagram.bytes !== Buffer.byteLength(diagram.html)) throw new Error(`Native child byte count mismatch: ${id}`); }
  const children = Object.fromEntries(Object.entries(diagrams).map(([id,diagram]) => [id,{diagramType:diagram.diagramType,html:diagram.html,sha256:diagram.sha256 || hash(diagram.html),bytes:diagram.bytes ?? Buffer.byteLength(diagram.html),semantic:diagram.semantic,checks:portableChecks(diagram.checks),composition:diagram.composition,specSha256:diagram.specSha256}]));
  // What a reader can check, stated next to the maker's mark.
  const pinned = Object.values(sources).find(source=>source?.path && source.revision)?.revision;
  const facts = [words.facts.panels(document.panels.length),Object.keys(diagrams).length && words.facts.diagrams(Object.keys(diagrams).length),citations.size && words.facts.sources(citations.size),pinned && words.facts.pinned(String(pinned).slice(0,7))].filter(Boolean);
  const colophon = `<div class="colophon"><a class="colophon-brand" href="https://github.com/tt-a1i/archify" target="_blank" rel="noopener noreferrer"><span class="colophon-mark" aria-hidden="true">${mark}</span><span class="colophon-words"><span class="colophon-name">Archify</span><span class="colophon-tagline">${words.tagline}</span></span></a><p class="colophon-facts">${facts.map(fact=>`<span>${escape(fact)}</span>`).join('')}</p></div>`;
  const footnotesHtml = footnotes.length ? `<section class="typical-footnotes"><h2>${english?'Typical value notes':'典型值说明'}</h2><ol>${footnotes.map(note=>`<li id="${escape(note.id)}">${escape(note.label)}: ${escape(note.text)}</li>`).join('')}</ol></section>` : '';
  const manifest = {version:1,artifactId:document.meta.id,revision,documentSha256:hash(JSON.stringify(document)),sourceSha256,dependencies:[...(preparedSources.dependencies || []),...(preparedDiagrams.dependencies || [])].map(({contentBase64,...entry})=>entry),children:Object.fromEntries(Object.entries(children).map(([id,child])=>[id,{sha256:child.sha256,bytes:child.bytes,diagramType:child.diagramType,checks:child.checks,composition:child.composition,specSha256:child.specSha256}])),sources:Object.fromEntries(Object.entries(sources).map(([id,source])=>[id,Object.fromEntries(Object.entries(source || {}).filter(([key])=>key !== 'text'))])),assets:Object.fromEntries(Object.entries(assets).map(([id,asset])=>[id,{sha256:asset.sha256,bytes:asset.bytes,mime:asset.mime}])),diagnostics};
  const bundle = preparedBundle || {schemaVersion:1,kind:'archify-explainer-prepared',sourceText,sourceMap,sourcePath,document,format:'json',diagnostics,preparedSources,preparedDiagrams,dependencies:[...(preparedSources.dependencies || []),...(preparedDiagrams.dependencies || [])],source:{sha256:sourceSha256,bytes:Buffer.byteLength(sourceText)}};
  if (!preparedBundle) bundle.digest = hash(JSON.stringify(bundle));
  if (bundle.sourceText !== sourceText || JSON.stringify(bundle.document) !== JSON.stringify(document)) throw new Error('Prepared bundle differs from rendered source or canonical document.');
  const page = portableBundle(bundle, pageDirectory || bundle.baseDir || (bundle.sourcePath && path.dirname(bundle.sourcePath)));
  manifest.diagnostics = page.diagnostics;
  manifest.dependencies = (page.dependencies || []).map(({contentBase64,...entry})=>entry);
  return `<!doctype html>\n<html lang="${escape(locale)}" data-style="${escape(document.meta.style || 'clean')}" data-archify-artifact="explainer" data-artifact="${escape(document.meta.id)}" data-revision="${revision}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="description" content="${escape(document.answer.summary)}"><title>${escape(titleText)} · Archify</title><link rel="icon" type="image/svg+xml" href="${favicon}"><style>${css}</style>${softwareNoticesHtml}</head><body><a class="skip-link" href="#board">${english?'Skip to content':'跳至正文'}</a><div class="shell"><header class="masthead"><h1>${titleHtml}</h1><div class="tools interactive"><div class="theme-controls" role="group" aria-label="${english?'Theme':'主题'}">${['auto','light','dark'].map(theme=>`<button type="button" data-theme-choice="${theme}" aria-pressed="${theme === 'auto'}">${words[theme]}</button>`).join('')}</div><div class="tool-menu style-menu"><button type="button" class="tool-button" data-style-toggle aria-haspopup="menu" aria-expanded="false" aria-label="${words.style}"><span class="style-swatch" data-swatch="${escape(document.meta.style || 'clean')}"></span><span data-style-label>${words.styles[document.meta.style || 'clean']}</span>${icons.chevron}</button><div class="menu-options style-options" role="menu" aria-label="${words.style}" hidden>${['clean','editorial','product','swiss'].map(style=>`<button type="button" role="menuitemradio" aria-checked="${style === (document.meta.style || 'clean')}" data-style-choice="${style}" tabindex="-1"><span class="style-swatch" data-swatch="${style}"></span><span>${words.styles[style]}</span>${icons.check}</button>`).join('')}</div></div><div class="tool-menu export-menu"><button type="button" class="tool-button" data-export-toggle aria-haspopup="menu" aria-expanded="false">${icons.export}<span>${words.export}</span>${icons.chevron}</button><div class="menu-options" role="menu" aria-label="${words.export}" hidden><p class="menu-label" role="presentation">${words.image}</p>${[['png','PNG'],['webp','WebP'],['jpeg','JPG']].map(([format,label],index)=>`<button type="button" role="menuitem" tabindex="-1" data-export-image="${format}" aria-label="${words.image} ${label}">${icons.image}<span>${label}</span><small>${words.imageHints[index]}</small></button>`).join('')}<hr role="separator"><button type="button" role="menuitem" tabindex="-1" data-print>${icons.print}<span>${words.print}</span></button></div></div></div></header><main id="board"><div class="board">${panels}</div></main><footer>${footnotesHtml}<section class="sources"><h2>${words.sources}</h2><ol>${sourceList}</ol></section>${colophon}</footer></div><dialog class="viewer-dialog" id="diagram-dialog" aria-labelledby="diagram-dialog-title"><header><h2 id="diagram-dialog-title"></h2><button type="button" class="viewer-close" data-close-diagram>${icons.close}<span>${words.close}</span><kbd>Esc</kbd></button></header><p class="dialog-loading" role="status">${words.loading}</p></dialog><div id="toast" role="status" aria-live="polite"></div><script type="application/json" id="archify-explainer-prepared">${json(packPageBundle(page))}</script><script type="application/json" id="explainer-manifest">${json(manifest)}</script><script type="application/json" id="explainer-reader-words">${json(words)}</script><script>${js}</script></body></html>`;
}

// Native check filenames refer to disposable build files, not reader resources.
function portableChecks(checks) {
  if (!checks?.check) return checks;
  const {file, ...check} = checks.check;
  return {...checks,check};
}

// A page is shared, so the draft it carries names local files relative to the page, never by absolute
// path: the reader sees no author directories. `patch explainer` resolves them against the page again.
function portableBundle({inputPath: _executionInput, ...bundle}, directory) {
  // The child delivery validates this execution-only binding, but a shared page
  // must retain only the original draft origin for later edits.
  if (!directory) return _executionInput === undefined ? bundle : {...bundle,digest:hash(JSON.stringify({...bundle,digest:undefined}))};
  const local = value => {
    if (typeof value !== 'string') return value;
    const paths = path.win32.isAbsolute(value) && !path.posix.isAbsolute(value) ? path.win32 : path;
    if (!paths.isAbsolute(value)) return value;
    const relative = paths.relative(directory, value);
    // Different Windows volumes have no relative path. Frozen content stays usable;
    // a missing origin must not be mistaken for the output directory during patching.
    return paths.isAbsolute(relative) ? null : relative || '.';
  };
  const subject = entry => entry?.subject ? {...entry,subject:{...entry.subject,...('input' in entry.subject ? {input:local(entry.subject.input)} : {}),...('output' in entry.subject ? {output:local(entry.subject.output)} : {})}} : entry;
  const page = {...bundle,sourcePath:local(bundle.sourcePath),...('baseDir' in bundle ? {baseDir:local(bundle.baseDir)} : {}),
    preparedDiagrams:{...bundle.preparedDiagrams,diagrams:Object.fromEntries(Object.entries(bundle.preparedDiagrams?.diagrams || {}).map(([id,diagram])=>[id,{...diagram,checks:portableChecks(diagram.checks)}]))},
    dependencies:(bundle.dependencies || []).map(entry=>entry.path ? {...entry,path:local(entry.path)} : entry),diagnostics:(bundle.diagnostics || []).map(subject)};
  page.digest = hash(JSON.stringify({...page,digest:undefined}));
  return page;
}

// Prefix native SVG identifiers in the preview only. Original native HTML is frozen above.
function staticSvg(svg, id) {
  const prefix = previewPrefix(id) + '-';
  // Only element IDs are prefixed; data-node-id and data-edge-id stay semantic for step links.
  const ids = new Map([...svg.matchAll(/(?<![\w-])id="([^"]+)"/g)].map(match => [match[1],prefix + match[1]]));
  return svg.replace(/(?<![\w-])id="([^"]+)"/g,(_,value)=>`id="${escape(ids.get(value))}"`)
    .replace(/url\(#([^\)]+)\)/g,(_,value)=>`url(#${ids.get(value) || value})`)
    .replace(/\b(href|xlink:href)="#([^"]+)"/g,(_,attr,value)=>`${attr}="#${escape(ids.get(value) || value)}"`)
    .replace(/\b(aria-labelledby|aria-describedby)="([^"]+)"/g,(_,attr,value)=>`${attr}="${escape(value.split(/\s+/).map(id=>ids.get(id) || id).join(' '))}"`)
    .replace(/\s(?:tabindex="[^"]*"|role="button"|aria-pressed="[^"]*")/g,'');
}

// A scope written as "a · b · c" reads as separate conditions; anything else stays a sentence.
function scopeParts(scope) { return scope.split(/\s+·\s+/).map(part=>part.trim()).filter(Boolean); }

// Split a selector list on its top-level commas; commas inside :is(), :not() or attribute values stay.
function selectorList(selector) {
  const parts = []; let depth = 0, quote = '', start = 0;
  for (let i = 0; i < selector.length; i++) {
    const c = selector[i];
    if (quote) { if (c === quote && selector[i-1] !== '\\') quote = ''; }
    else if (c === '"' || c === "'") quote = c;
    else if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === ',' && !depth) { parts.push(selector.slice(start,i)); start = i + 1; }
  }
  return [...parts, selector.slice(start)];
}
const nativeStyles = html => [...String(html).matchAll(/<style\b[^>]*>[\s\S]*?<\/style>/g)].map(match => match[0]).join('\n');
function previewPrefix(id) { return `preview-${id.replace(/[^A-Za-z0-9_-]/g,'-')}`; }

// Native CSS is scoped to its static preview. No native body/chrome layout enters the reader.
// The preview sets text in page fonts and shows only the SVG, so font faces and rules that name a
// class absent from the SVG (Viewer chrome, toolbars, cards) are dropped.
function scopeNativeCss(styles, scope, prefix, svg = '') {
  const css = styles.replace(/<style[^>]*>/gi,'').replace(/<\/style>/gi,'').replace(/\/\*[\s\S]*?\*\//g,'');
  const present = new Set(svg ? [...svg.matchAll(/\bclass="([^"]*)"/g)].flatMap(match => match[1].split(/\s+/)) : []);
  const applies = value => !svg || [...value.replace(/:not\([^)]*\)/g,'').matchAll(/\.([A-Za-z_][\w-]*)/g)].every(match => present.has(match[1]));
  const defaults = []; const systemDark = []; const systemLight = [];
  function rules(input, collectThemes = true) {
    let result = ''; let cursor = 0;
    while (cursor < input.length) {
      const opening = input.indexOf('{',cursor); if(opening < 0) break;
      const selector = input.slice(cursor,opening).trim(); let depth = 1; let end = opening + 1; let quote = '';
      for(; end < input.length && depth; end++) { const c = input[end]; if(quote) {if(c === quote && input[end-1] !== '\\') quote = '';} else if(c === '\"' || c === "'") quote = c; else if(c === '{') depth++; else if(c === '}') depth--; }
      const body = input.slice(opening + 1,end-1).replace(/url\(#([^\)]+)\)/g,(_,id)=>`url(#${prefix}${id})`); cursor = end;
      if(selector.startsWith('@media') || selector.startsWith('@supports') || selector.startsWith('@layer')) { result += `${selector}{${rules(body,false)}}`; continue; }
      if(selector.startsWith('@')) continue;
      const selectors = selectorList(selector).filter(value=>!/(^|[\s>+~])body(?:\b|$)/.test(value) && applies(value)).map(value=>{
        let next = value.trim().replace(/#([A-Za-z][\w-]*)/g,(_,id)=>'#' + prefix + id);
        next = next.replace(/^:root|^html\b/,scope);
        if (next.startsWith('[data-theme=') || next.startsWith('[data-preset=')) next = scope + next;
        return next.startsWith(scope) ? next : `${scope} ${next}`;
      });
      const rootSelectors = selectorList(selector).map(value=>value.trim());
      if (collectThemes && rootSelectors.includes(':root')) defaults.push(body);
      if (collectThemes && rootSelectors.some(value=>/^(?:\:root)?\[data-theme=[\"']?dark[\"']?\]$/.test(value))) systemDark.push(body);
      if (collectThemes && rootSelectors.some(value=>/^(?:\:root)?\[data-theme=[\"']?light[\"']?\]$/.test(value))) systemLight.push(body);
      if(selectors.length) result += `${selectors.join(',')}{${body}}`;
    }
    return result;
  }
  const scoped = rules(css);
  const light = systemLight.length ? systemLight : defaults;
  return scoped + (systemLight.length ? `${scope}:not([data-theme]){${systemLight.join(';')}}` : '') + (systemDark.length ? `@media(prefers-color-scheme:dark){${scope}:not([data-theme]){${systemDark.join(';')}}}` : '') + (light.length ? `@media print{${scope},${scope}[data-theme],${scope}:not([data-theme]){${light.join(';')}}}` : '');
}
