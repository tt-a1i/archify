import { createHash } from 'node:crypto';

const COMPONENTS = [
 ['content','内容正确'],['layout','布局可读'],
 ['speed','速度效率'],['cost','成本效率'],['human','人工观感'],
];
const TOTALS=[['automatic','自动总分'],['comprehensive','综合分']];
const readScore=(row,key)=>TOTALS.some(([name])=>name===key)?row?.[key]:row?.scores?.[key];
const RATINGS = [
 ['readability','阅读追踪','文字、节点和连线是否容易阅读与追踪？'],
 ['hierarchy','层级分组','主次关系与分组是否清楚？'],
 ['layout','排版平衡','空间、对齐和疏密是否协调？'],
 ['style','风格一致性','字体、线条、形状与配色是否一致？'],
 ['aesthetics','整体审美','你是否愿意采用这张图？'],
];
const escape = value => String(value ?? '').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const score = value => typeof value==='number' && Number.isFinite(value) && value>=0 && value<=100;
const finite = value => typeof value==='number' && Number.isFinite(value) && value>=0;
const number = value => score(value) ? value.toFixed(1) : '未测量';
const rawNumber = (value,digits=0) => finite(value) ? value.toLocaleString('en-US',{minimumFractionDigits:digits,maximumFractionDigits:digits}) : '未测量';
const json = value => JSON.stringify(value).replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/&/g,'\\u0026').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');

function localPath(value) {
 return typeof value==='string' && /^(?:artifacts\/[a-f0-9]{64}\.(?:html|png)|evidence\/[a-f0-9]{64}\.[a-z0-9]{1,12})$/.test(value) ? value : null;
}
function digestPath(receipt) {
 const path=localPath(receipt?.artifactPath);
 return path && /^[a-f0-9]{64}$/.test(receipt?.artifactHash??'') && path===`artifacts/${receipt.artifactHash}.${path.split('.').at(-1)}` ? path : null;
}
const link=(path,label)=>localPath(path)?`<a href="${escape(path)}" target="_blank" rel="noopener noreferrer">${escape(label)}</a>`:'';
const delta=value=>typeof value==='number'&&Number.isFinite(value)?`${value>0?'+':''}${value.toFixed(1)}`:'未测量';
const seconds=value=>finite(value)?rawNumber(value/1000,1):'未测量';
function comparisonOf(value) {
 if(value?.schemaVersion!==1 || value.kind!=='archify-before-after' || !Array.isArray(value.pairs)) throw new TypeError('Expected schemaVersion 1 archify-before-after comparison');
 return value;
}
function metricChart(base,candidate,id,components=COMPONENTS) {
 const bars=components.map(([key,label],i)=>{
  const y=35+i*68;
  return `<text x="8" y="${y+12}">${escape(label)}</text>${[[base,'修改前','#68829a'],[candidate,'修改后','#125ed4']].map(([arm,name,color],j)=>{
   const value=readScore(arm,key),yy=y+j*23;
   return `<g><title>${label} ${name}：${number(value)}</title>${score(value)?`<rect x="120" y="${yy}" width="${value*3}" height="17" fill="${color}" data-score="${value}"/>`:''}<text x="435" y="${yy+14}">${name} ${number(value)}</text></g>`;
  }).join('')}`;
 }).join('');
 return `<svg class="metric-chart" viewBox="0 0 570 ${components.length*68+60}" role="img" aria-labelledby="${id}"><title id="${id}">分数修改前后对比，统一 0–100 尺度，越高越好</title>${[0,25,50,75,100].map(n=>`<line x1="${120+n*3}" x2="${120+n*3}" y1="22" y2="${components.length*68+33}" stroke="#d6e0ea"/><text x="${120+n*3}" y="${components.length*68+53}" text-anchor="middle">${n}</text>`).join('')}${bars}</svg>`;
}
function scoreTable(base,candidate,deltas,components=COMPONENTS) {
 return `<div class="table-wrap"><table><thead><tr><th>分项（0–100）</th><th>修改前</th><th>修改后</th><th>变化（后 − 前）</th></tr></thead><tbody>${components.map(([key,label])=>`<tr><th scope="row">${label}</th><td>${number(readScore(base,key))}</td><td>${number(readScore(candidate,key))}</td><td>${delta(score(readScore(base,key))&&score(readScore(candidate,key))?(deltas?.[key]??readScore(candidate,key)-readScore(base,key)):null)}</td></tr>`).join('')}</tbody></table></div>`;
}
function rawTable(base,candidate,average=false) {
 const rows=[['实际完整会话用时（秒）',row=>seconds(row?.raw?.durationMs)],['最终交付用时（秒）',row=>seconds(row?.raw?.deliveryDurationMs)],['总 tokens',row=>rawNumber(row?.raw?.totalTokens)],['实际费用（USD）',row=>rawNumber(row?.raw?.costUsd,4)]];
 return `<div class="table-wrap"><table><thead><tr><th>${average?'每题平均原始测量':'单次运行原始测量'}</th><th>修改前</th><th>修改后</th></tr></thead><tbody>${rows.map(([label,read])=>`<tr><th scope="row">${average?'每题平均':''}${label}</th><td>${read(base)}</td><td>${read(candidate)}</td></tr>`).join('')}</tbody></table></div>`;
}
function evidenceArm(row,name,revision) {
 if(!row) return `<section class="panel"><h3>${name}</h3><p class="missing">缺少运行记录（未测量）</p></section>`;
 const evidence=row.evidence??{},preview=localPath(evidence.previewPath),candidates=evidence.candidates??[];
 const defects={evidenceMissing:evidence.missing??[],semanticMeasurements:row.semanticMeasurements??null,semanticDefects:row.semanticDefects??[],layoutDetails:row.layoutDetails??null,sourceEvidence:row.sourceEvidence??null,missing:row.missing??[],human:row.human??null};
 return `<section class="panel"><h3>${name}</h3><p>修订 ${escape(row.revision??revision)} · 模型 ${escape(row.model??'未记录')}</p><p>交付状态：${escape(row.receipt?.delivery?.status??row.delivery?.status??row.status??'未记录')} · 评分状态：${escape(row.status??'未记录')} · 修复次数：${Number.isInteger(row.repairCount)&&row.repairCount>=0?row.repairCount:'未记录'}</p>${preview&&preview.endsWith('.png')?`<img class="preview" src="${escape(preview)}" alt="${name}产物预览" loading="lazy">`:''}<p class="evidence-links">${[[evidence.sourcePath,'源文件'],[evidence.artifactPath,'最终产物'],[evidence.sessionPath,'完整会话'],[evidence.promptPath,'原始提示词'],[evidence.receiptPath,'原始测量记录']].map(([path,label])=>link(path,label)).filter(Boolean).join(' · ')}</p><p>候选历史：${evidence.historyComplete===true?'完整':evidence.historyComplete===false?'不完整':'未记录'}</p><ol>${candidates.map((item,index)=>`<li>${index===0?'首次候选':'修复候选 '+index}${index===candidates.length-1?' / 最终候选':''} ${escape(item.submittedAt??'')} ${[[item.sourcePath,'源文件'],[item.artifactPath,'产物'],[item.receiptPath,'交付凭据']].map(([path,label])=>link(path,label)).filter(Boolean).join(' · ')}</li>`).join('')}</ol><details open><summary>语义、布局缺陷与缺测依据</summary><pre>${escape(JSON.stringify(defects,null,2))}</pre></details></section>`;
}

/** Static before/after evidence with raw data, component scores and versioned weighted totals. */
export function renderComparisonReport(input) {
 const comparison=comparisonOf(input),base=comparison.summary?.base,candidate=comparison.summary?.candidate;
 const coverage=arm=>['planned','recorded','delivered','failed','missing'].map((key,i)=>`${['计划','已记录','已交付','失败','缺失'][i]} ${escape(arm?.[key]??'未记录')}`).join(' · ');
 return page('Archify 修改前后绘图对比',`<main><header><h1>Archify 修改前后绘图对比</h1><p class="metadata">修改前 ${escape(comparison.baseRevision)} → 修改后 ${escape(comparison.candidateRevision)} · 指标版本 ${escape(comparison.metricsVersion)}</p><p class="metadata">${escape(comparison.evidenceOrigin??'记录导入比较；请核对逐题证据来源')}</p><p class="notice">总分与分项均为 0–100，越高越好；原始测量值并列保留。人工评分选填，未评分时综合分为空，自动总分正常计算。已知交付失败计 0，未知数据不补零。</p></header><section class="section"><h2>总分对比与覆盖</h2><p>修改前：${coverage(base)}<br>修改后：${coverage(candidate)}</p>${metricChart(base,candidate,'summary-totals',TOTALS)}${scoreTable(base,candidate,undefined,TOTALS)}<p class="score-note">权重：${escape(comparison.scoreWeights?Object.entries(comparison.scoreWeights).map(([key,value])=>`${COMPONENTS.find(([name])=>name===key)?.[1]??key} ${+(value*100).toFixed(6)}%`).join(' · '):'未记录')}。自动总分为四项自动指标加权后除以自动权重之和；综合分包含人评。${base?.humanProvisional||candidate?.humanProvisional?'含单人试点评分。':''}</p><h3>分项分数</h3>${metricChart(base,candidate,'summary-metrics')}${scoreTable(base,candidate)}<h3>每题平均原始测量</h3>${rawTable(base,candidate,true)}<p class="score-note">汇总先对同题的重复运行取平均，再对任务等权平均；费用和 tokens 为每题平均值。完整会话用时与最终交付用时分别记录；最终交付用时包含生成、修复与工具等待，不以完整会话用时替代。tokens 与 USD 均来自实际记录，缺测不补零。</p></section><section class="section"><h2>逐题对比与证据</h2>${comparison.pairs.map((pair,index)=>`<article class="section"><h3>${escape(pair.taskId)} · ${escape(pair.model)} · 第 ${escape(pair.repeat)} 次</h3>${pair.prompt?`<details><summary>任务提示词</summary><p>${escape(pair.prompt)}</p></details>`:''}${scoreTable(pair.base,pair.candidate,pair.delta,TOTALS)}${scoreTable(pair.base,pair.candidate,pair.delta)}${rawTable(pair.base,pair.candidate)}<div class="arms">${evidenceArm(pair.base,'修改前',comparison.baseRevision)}${evidenceArm(pair.candidate,'修改后',comparison.candidateRevision)}</div></article>`).join('')||'<p class="empty">暂无任务记录。</p>'}</section><footer>比较应保持任务、模型、预算和指标版本一致。请结合逐题原始证据判断变化。</footer></main>`,'.metric-chart{width:min(100%,700px);height:auto;font:13px system-ui}.arms{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px;margin-top:18px}.arms .panel{min-width:0;overflow-wrap:anywhere}.preview{display:block;width:100%;height:330px;object-fit:contain;background:#f2f6fa}.evidence-links{margin:12px 0}@media(max-width:760px){.arms{grid-template-columns:1fr}.preview{height:auto}}');
}
function csvCell(value) {
 if(typeof value==='number' && Number.isFinite(value)) return String(value);
 let text=String(value??'');
 if(/^[\s]*[=+\-@]/.test(text)) text="'"+text;
 return /[",\r\n]/.test(text)?`"${text.replace(/"/g,'""')}"`:text;
}
export function comparisonCSV(input) {
 const comparison=comparisonOf(input);
 const header=['taskId','model','repeat','arm','revision','status','deliveryStatus','repairCount',...TOTALS.map(([key])=>key),...COMPONENTS.map(([key])=>key),...[...TOTALS,...COMPONENTS].map(([key])=>`delta.${key}`),'durationMs','deliveryDurationMs','totalTokens','costUsd','sourcePath','artifactPath','previewPath','sessionPath'];
 const rows=comparison.pairs.flatMap(pair=>['base','candidate'].map(arm=>{
  const row=pair[arm];
  return [pair.taskId,pair.model,pair.repeat,arm,row?.revision??comparison[arm==='base'?'baseRevision':'candidateRevision'],row?.status??'missing',row?.receipt?.delivery?.status??row?.delivery?.status??'',Number.isInteger(row?.repairCount)?row.repairCount:null,...[...TOTALS,...COMPONENTS].map(([key])=>score(readScore(row,key))?readScore(row,key):null),...[...TOTALS,...COMPONENTS].map(([key])=>score(readScore(pair.base,key))&&score(readScore(pair.candidate,key))&&typeof pair.delta?.[key]==='number'&&Number.isFinite(pair.delta[key])?pair.delta[key]:null),...['durationMs','deliveryDurationMs','totalTokens','costUsd'].map(key=>finite(row?.raw?.[key])?row.raw[key]:null),...['sourcePath','artifactPath','previewPath','sessionPath'].map(key=>localPath(row?.evidence?.[key])??'')];
 }));
 return '\uFEFF'+[header,...rows].map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';
}

function page(title,body,extraStyle='',policy="default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'",script='') {
 return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${escape(policy)}"><title>${escape(title)}</title><style>${STYLE}\n${extraStyle}</style></head><body>${body}${script}</body></html>`;
}
const STYLE = `
:root{color-scheme:light;--ink:#16324a;--muted:#536979;--blue:#125ed4;--line:#d6e0ea}
*{box-sizing:border-box}body{margin:0;background:#f2f6fa;color:var(--ink);font:16px/1.6 system-ui,"PingFang SC","Microsoft YaHei",sans-serif}main{max-width:1440px;margin:auto;padding:46px 44px 72px}h1,h2,h3,p{margin:0}h1{font-size:clamp(26px,3vw,40px);line-height:1.25}h2{font-size:25px}h3{font-size:19px}a{color:#0b52b6;text-underline-offset:3px}a:focus-visible,summary:focus-visible,input:focus-visible,textarea:focus-visible,button:focus-visible{outline:3px solid #cb7714;outline-offset:4px}.muted,.metadata,.score-note,footer{color:var(--muted)}.metadata{margin-top:12px;font-size:14px}.notice{margin-top:20px;padding:13px 18px;background:#fff6d7;border-left:5px solid #b87905;color:#674306}.panel{background:#fff;border:1px solid var(--line);padding:22px 26px}.section{margin-top:34px}.section>p{margin:8px 0 18px}.table-wrap{overflow-x:auto;background:#fff;border:1px solid var(--line);margin-top:14px}table{width:100%;border-collapse:collapse;text-align:left;font-variant-numeric:tabular-nums}th,td{padding:13px 17px;border-bottom:1px solid var(--line);vertical-align:middle}th{background:#edf3f9;font-size:14px;font-weight:650;white-space:nowrap}td{font-size:16px}tbody tr:last-child td{border-bottom:0}.missing{color:#87520a}.score-note{font-size:13px;margin-top:10px}details{border-top:1px solid var(--line);padding:16px 0}summary{font-size:17px;font-weight:650;cursor:pointer}details p{margin-top:10px}pre{font:12px/1.5 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere;background:#edf3f9;padding:16px;margin-top:14px}footer{margin-top:30px;font-size:13px}.empty{padding:25px;color:var(--muted)}
@media(max-width:760px){main{padding:26px 16px 42px}.panel{padding:17px}th,td{padding:11px 13px}.section{margin-top:26px}}@media print{body{background:#fff}main{max-width:none;padding:0}details{break-inside:avoid}}
`;

function shuffled(items,seed) {
 const result=[...items],digest=createHash('sha256').update(String(seed)).digest();
 let state=digest.readUInt32LE(0)||1;
 for(let i=result.length-1;i>0;i--) {state^=state<<13;state^=state>>>17;state^=state<<5;const j=(state>>>0)%(i+1);[result[i],result[j]]=[result[j],result[i]];}
 return result;
}
function taskContext(task) {
 const prompt=task?.prompt??task?.description??'';
 const nodes=(task?.expected?.nodes??[]).map(node=>String(node.label??node.id??''));
 const byId=new Map((task?.expected?.nodes??[]).map(node=>[node.id,node.label??node.id]));
 const edges=(task?.expected?.edges??[]).map(edge=>`${byId.get(edge.from)??edge.from} → ${byId.get(edge.to)??edge.to}${edge.label?`（${edge.label}）`:''}`);
 const requirements=Array.isArray(task?.requirements)?task.requirements:typeof task?.requirements==='string'?[task.requirements]:[];
 return `${prompt?`<p>${escape(prompt)}</p>`:''}${nodes.length?`<p><strong>必需节点：</strong>${nodes.map(escape).join('、')}</p>`:''}${edges.length?`<p><strong>必需关系：</strong>${edges.map(escape).join('；')}</p>`:''}${requirements.length?`<p><strong>要求：</strong>${requirements.map(escape).join('；')}</p>`:''}`;
}

/** Keep all browser-side code in this function so the exact script can be CSP-hashed. */
function reviewClient() {
 const state=JSON.parse(document.getElementById('review-state').textContent);
 const form=document.getElementById('review-form'),status=document.getElementById('download-status');
 form.addEventListener('submit',event=>{
  event.preventDefault();
  if(!form.reportValidity()) return;
  const data=new FormData(form),reviewerId=String(data.get('reviewerId')??'').trim();
  if(!reviewerId) {status.textContent='请填写评审标识。';return;}
  if(data.get('independent')!=='yes') {status.textContent='请确认独立评分。';return;}
  const reviews=state.items.map((item,index)=>{
   const ratings={};
   for(const field of ['readability','hierarchy','layout','style','aesthetics']) {
    const value=Number(data.get(`rating-${index}-${field}`));
    if(!Number.isInteger(value)||value<1||value>5) throw new Error('每题的五个评分都需要填写。');
    ratings[field]=value;
   }
   const review={taskId:item.taskId,artifactHash:item.artifactHash,reviewerId,rubricVersion:state.rubricVersion,status:'completed',independent:true,ratings};
   if(item.taskHash) review.taskHash=item.taskHash;
   if(item.reviewImageHash) review.reviewImageHash=item.reviewImageHash;
   const comment=String(data.get(`comment-${index}`)??'').trim();if(comment) review.comment=comment;
   return review;
  });
  const blob=new Blob([JSON.stringify({reviews},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),anchor=document.createElement('a');
  anchor.href=url;anchor.download='diagram-quality-reviews.json';document.body.appendChild(anchor);anchor.click();anchor.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  status.textContent=`已下载 ${reviews.length} 份评分。请将 JSON 交回实验负责人。`;
 });
}

/** A static, local-only blind form. Receipt identities are never serialized wholesale. */
export function renderReviewForm({receipts,tasks,seed='pilot',rubricVersion='diagram-quality-human-v1'}) {
 if(!Array.isArray(receipts)) throw new TypeError('receipts must be an array');
 const taskList=Array.isArray(tasks)?tasks:tasks?.tasks??[],byTask=new Map(taskList.map(task=>[task.id??task.taskId,task]));
 const seen=new Set(),items=[];
 for(const receipt of receipts) {
  if(receipt.delivery?.status && receipt.delivery.status!=='delivered') continue;
  if(!receipt.artifactHash) continue;
  if(typeof receipt.taskId!=='string' || !receipt.taskId || !/^[a-f0-9]{64}$/i.test(receipt.artifactHash)) throw new TypeError('Review receipt requires task identity and artifact digest');
  let previewPath=receipt.artifactPath,reviewImageHash;
  if(receipt.reviewImage!=null) {
   const image=receipt.reviewImage;
   if(typeof image.hash!=='string' || !/^[a-f0-9]{64}$/i.test(image.hash) || image.path!==`artifacts/${image.hash}.png`) throw new TypeError('reviewImage requires a digest-only artifacts/<hash>.png path');
   previewPath=image.path;reviewImageHash=image.hash;
  } else if(!digestPath(receipt)) throw new TypeError('Review receipt requires digest-relative artifactPath');
  const key=JSON.stringify([receipt.taskId,receipt.artifactHash]);if(seen.has(key)) continue;seen.add(key);
  const item={taskId:receipt.taskId,artifactHash:receipt.artifactHash,previewPath,...(reviewImageHash?{reviewImageHash}:{})};
  if(typeof receipt.taskHash==='string'&&/^[a-f0-9]{64}$/i.test(receipt.taskHash)) item.taskHash=receipt.taskHash;
  items.push(item);
 }
 const ordered=shuffled(items,seed),state={rubricVersion,items:ordered.map(({taskId,artifactHash,taskHash,reviewImageHash})=>({taskId,artifactHash,...(taskHash?{taskHash}:{}),...(reviewImageHash?{reviewImageHash}:{})}))};
 const entries=ordered.map((item,index)=>`<article class="review-item"><div class="review-heading"><h2>作品 ${index+1}</h2><span class="muted">匿名顺序 ${index+1} / ${ordered.length}</span></div><details class="task-context" open><summary>题目与要求</summary>${taskContext(byTask.get(item.taskId))||'<p>请根据作品的可读性与观感评分。</p>'}</details>${item.reviewImageHash?`<img class="review-image" src="${escape(item.previewPath)}" alt="匿名作品 ${index+1} 预览">`:`<iframe src="${escape(item.previewPath)}" sandbox="" referrerpolicy="no-referrer" title="匿名作品 ${index+1} 预览"></iframe><p class="artifact-note">内嵌预览已禁用脚本；图内风格或标识仍可能暴露来源。</p>`}<p class="artifact-note"><a href="${escape(item.previewPath)}" target="_blank" rel="noopener noreferrer">单独查看作品</a> · 产物摘要 ${escape(item.artifactHash.slice(0,12))}…</p><div class="rating-grid">${RATINGS.map(([field,label,hint])=>`<fieldset><legend>${label}</legend><p class="rating-hint">${hint}</p><div class="choices">${[1,2,3,4,5].map(value=>`<label><input type="radio" name="rating-${index}-${field}" value="${value}" required><span>${value}</span></label>`).join('')}</div></fieldset>`).join('')}</div><label class="comment-label" for="comment-${index}">评论（选填）</label><textarea id="comment-${index}" name="comment-${index}" rows="2" placeholder="可记录让你加分或扣分的地方"></textarea></article>`).join('');
 const source=`(${reviewClient.toString()})();`,digest=createHash('sha256').update(source).digest('base64'),policy=`default-src 'none'; style-src 'unsafe-inline'; frame-src 'self' file:; img-src 'self'; script-src 'sha256-${digest}'; connect-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'`;
 return page('绘图 Benchmark 匿名人工评分',`<main class="review-page"><header><h1>匿名人工评分</h1><p class="metadata">请独立查看每张图，为五个方面各选 1–5 分。1 分最低，3 分一般，5 分最高。评论选填。</p><p class="notice">评分不显示方法、模型、费用或自动成绩。请按当前作品的阅读体验与视觉观感评分。</p></header><form id="review-form"><div class="reviewer panel"><label for="reviewer-id">评审标识 <span class="muted">（使用稳定化名即可）</span></label><input id="reviewer-id" name="reviewerId" type="text" required maxlength="100" autocomplete="off" placeholder="例如 reviewer-01"><label class="independent"><input name="independent" type="checkbox" value="yes" required>我独立完成本次评分，未参考其他评审的答案。</label></div>${entries||'<p class="empty">暂无可评分的已交付作品。</p>'}<div class="download"><button type="submit" ${ordered.length?'':'disabled'}>下载评分 JSON</button><p id="download-status" role="status" aria-live="polite">评分只保存在下载文件中；请在离开页面前下载。</p></div></form><footer>人工评分为选填；仅完整提交的评分可导入。五项平均分换算为 0–100 的人工观感：25 ×（平均分 − 1）。</footer></main>`,'\n.review-page{max-width:1380px}.reviewer{margin-top:26px}.reviewer>label:first-child{font-size:18px;font-weight:650}.reviewer>input{display:block;width:min(100%,440px);margin:8px 0 16px;padding:11px 13px;font:inherit;border:1px solid #8da5b8;border-radius:3px}.independent{display:flex;gap:10px;align-items:flex-start}.independent input{margin-top:7px;min-width:18px;min-height:18px}.review-item{background:#fff;border:1px solid var(--line);padding:26px;margin-top:28px}.review-heading{display:flex;justify-content:space-between;gap:16px;align-items:baseline}.task-context{border:0;padding:14px 0}.task-context p{max-width:90ch;font-size:14px;line-height:1.65}iframe{display:block;width:100%;height:620px;border:1px solid var(--line);background:#fff}.review-image{display:block;width:100%;height:auto;max-height:740px;object-fit:contain;border:1px solid var(--line);background:#fff}.artifact-note{font-size:13px;margin-top:8px;color:var(--muted)}.rating-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px;margin-top:22px}fieldset{margin:0;border:1px solid var(--line);padding:14px 14px 16px;min-width:0}legend{font-weight:750;padding:0 6px;font-size:17px}.rating-hint{font-size:13px;min-height:42px;color:var(--muted)}.choices{display:flex;gap:7px;margin-top:14px}.choices label{position:relative;flex:1;cursor:pointer}.choices input{position:absolute;opacity:0;width:100%;height:100%;margin:0;cursor:pointer}.choices span{display:block;border:1px solid #9aaebf;text-align:center;border-radius:3px;padding:9px 2px;font-size:18px}.choices input:checked+span{background:var(--blue);color:#fff;border-color:var(--blue);font-weight:750}.choices input:focus-visible+span{outline:3px solid #cb7714;outline-offset:3px}.comment-label{display:block;margin-top:20px;font-weight:650}textarea{display:block;width:100%;padding:10px 12px;margin-top:7px;border:1px solid #8da5b8;border-radius:3px;font:inherit;resize:vertical}.download{margin-top:28px;padding:22px;background:var(--ink);color:#fff;display:flex;align-items:center;gap:22px}.download p{font-size:14px;color:#d7e6f5}button{font:700 17px/1.5 inherit;padding:12px 23px;border:0;background:#fff;color:#104d9e;border-radius:3px;cursor:pointer;white-space:nowrap}button:disabled{opacity:.5;cursor:default}@media(max-width:850px){.rating-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:600px){.review-item{padding:17px}.rating-grid{grid-template-columns:1fr}.rating-hint{min-height:0}.review-heading{display:block}iframe{height:440px}.download{display:block}.download p{margin-top:13px}}',policy,`<script type="application/json" id="review-state">${json(state)}</script><script>${source}</script>`);
}
