const norm = value => String(value ?? '').trim().replace(/\s+/g,' ');
const verified = object => object?.status==='verified';
const key = n => n.key ?? n.id ?? n.label;
const labels = n => [n.label,...(n.aliases??[])].filter(v=>v!==undefined).map(norm);
const score = (matched,expected,actual) => {const precision=actual?matched/actual:expected?0:1,recall=expected?matched/expected:1;return {matched,expected,actual,precision,recall,f1:precision+recall?2*precision*recall/(precision+recall):0};};
// Augmenting paths maximize one-to-one credit even when aliases overlap.
function match(left,right,compatible) {
 const owner=new Map();
 const visit=(i,seen)=>{for(let j=0;j<right.length;j++){if(seen.has(j)||!compatible(left[i],right[j]))continue;seen.add(j);if(!owner.has(j)||visit(owner.get(j),seen)){owner.set(j,i);return true;}}return false;};
 left.forEach((_,i)=>visit(i,new Set()));return new Map([...owner].map(([j,i])=>[i,j]));
}
// Explicit shared identities resolve duplicate labels before aliases are considered.
// For the remainder, a maximum cardinality match is evidence only if its identity
// assignment is unique. Edge topology must not choose an arbitrary permutation.
function matchNodes(wanted, actual, compatible) {
 const fixed = new Map(), used = new Set();
 const explicit = node => [node.key, node.id].filter(value => value !== undefined);
 const candidates = wanted.map(a => actual.flatMap((b, j) =>
  compatible(a, b) && explicit(a).some(value => explicit(b).includes(value)) ? [j] : []));
 candidates.forEach((choices, i) => {
  if (choices.length === 1 && candidates.filter(other => other.includes(choices[0])).length === 1) {
   fixed.set(i, choices[0]); used.add(choices[0]);
  }
 });
 const left = wanted.map((_, i) => i).filter(i => !fixed.has(i));
 const right = actual.map((_, j) => j).filter(j => !used.has(j));
 const eligible = (i, j) => compatible(wanted[i], actual[j]);
 const remainder = match(left, right, eligible);
 const ambiguous = new Set();
 // A different maximum matching after removing any chosen pair proves ambiguity.
 for (const [i, j] of remainder) {
  const alternative = match(left, right, (a, b) =>
   !(a === left[i] && b === right[j]) && eligible(a, b));
  if (alternative.size !== remainder.size) continue;
  for (let k = 0; k < left.length; k++) {
   if (alternative.get(k) !== remainder.get(k)) ambiguous.add(left[k]);
  }
 }
 for (const [i, j] of remainder) fixed.set(left[i], right[j]);
 return {matches: fixed, ambiguous};
}
export function evaluateSemantics(expected, graph, observation) {
 const violations=[];let unknown=!verified(graph)||!verified(observation);
 expected=expected??{};const wanted=expected.nodes??[],actual=graph?.nodes??[],wantedEdges=expected.edges??[],actualEdges=graph?.edges??[];
 if(!Array.isArray(expected.nodes)||!Array.isArray(expected.edges)){unknown=true;violations.push({code:'missing_expected_facts'});}
 const supported=new Set(['nodes','edges','requiredLabels']);
 for(const k of Object.keys(expected))if(!supported.has(k)){unknown=true;violations.push({code:'unsupported_requirement',requirement:k});}
 const nodeFields=new Set(['id','key','label','aliases','type']);
 const edgeFields=new Set(['from','to','label','type']);
 for(const [facts,fields] of [[wanted,nodeFields],[wantedEdges,edgeFields]])for(const fact of facts)for(const field of Object.keys(fact))if(!fields.has(field)){unknown=true;violations.push({code:'unsupported_requirement',requirement:field});}
 if(unknown)violations.push({code:'incomplete_evidence'});
 const visibleNodes=observation?.nodes??[];
 const visibleMatch=match(actual,visibleNodes,(a,b)=>a.id===b.id&&b.visible===true&&norm(a.label)===norm(b.label));
 const observedIndices=new Set(visibleMatch.keys());
 const {matches:nodeMatch,ambiguous}=matchNodes(wanted,actual,(a,b)=>labels(a).includes(norm(b.label))&&(!a.type||a.type===b.type)&&observedIndices.has(actual.indexOf(b)));
 const ambiguousKeys=new Set([...ambiguous].map(i=>key(wanted[i])));
 if(ambiguous.size){unknown=true;violations.push({code:'ambiguous_node_mapping',keys:[...ambiguousKeys]});}
 const identities=new Map([...nodeMatch].filter(([i])=>!ambiguous.has(i)).map(([i,j])=>[key(wanted[i]),actual[j].id]));
 for(let i=0;i<wanted.length;i++)if(!nodeMatch.has(i)&&!ambiguous.has(i))violations.push({code:'missing_node',key:key(wanted[i])});
 const observedEdges=observation?.edges??[];
 const edgeVisible=match(actualEdges,observedEdges,(a,b)=>b.visible===true&&a.from===b.from&&a.to===b.to&&norm(a.label)===norm(b.label));
 const edgeMatch=match(wantedEdges,actualEdges,(a,b)=>identities.get(a.from)===b.from&&identities.get(a.to)===b.to&&norm(a.label)===norm(b.label)&&(!a.type||a.type===b.type)&&edgeVisible.has(actualEdges.indexOf(b)));
 for(let i=0;i<wantedEdges.length;i++)if(!edgeMatch.has(i)&&!ambiguousKeys.has(wantedEdges[i].from)&&!ambiguousKeys.has(wantedEdges[i].to))violations.push({code:'missing_edge',...wantedEdges[i]});
 const visibleLabels=[...(observation?.texts??[]).filter(t=>t.visible===true).map(t=>norm(t.text)),...visibleNodes.filter(n=>n.visible===true).map(n=>norm(n.label)),...observedEdges.filter(e=>e.visible===true).map(e=>norm(e.label))];
 for(const label of expected.requiredLabels??[])if(!visibleLabels.includes(norm(label)))violations.push({code:'missing_required_label',label});
 const nodes=score(nodeMatch.size,wanted.length,actual.length),edges=score(edgeMatch.size,wantedEdges.length,actualEdges.length);
 if(nodes.precision<1)violations.push({code:'unexpected_nodes',count:actual.length-nodeMatch.size});
 if(ambiguous.size && (wantedEdges.length || actualEdges.length)){edges.unverified=wantedEdges.filter(e=>ambiguousKeys.has(e.from)||ambiguousKeys.has(e.to)).length;edges.precision=null;edges.recall=null;edges.f1=null;}
 if(edges.precision!==null&&edges.precision<1)violations.push({code:'unexpected_edges',count:actualEdges.length-edgeMatch.size});
 return {status:unknown?'unverified':'verified',passed:!unknown&&!violations.length,nodes,edges,violations};
}
const validRect=r=>r&&['x','y','width','height'].every(k=>Number.isFinite(r[k]))&&r.width>0&&r.height>0;
const contains=(a,b,e=0)=>b.x>=a.x-e&&b.y>=a.y-e&&b.x+b.width<=a.x+a.width+e&&b.y+b.height<=a.y+a.height+e;
const intersection=(a,b)=>({width:Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x),height:Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y)});
// Open interior intersection; endpoint/port contact at the rectangle border is legal.
function segmentInside(p,q,r,e) {
 const box={x:r.x+e,y:r.y+e,width:r.width-2*e,height:r.height-2*e};if(box.width<=0||box.height<=0)return false;
 let low=0,high=1;
 for(const axis of ['x','y']){const delta=q[axis]-p[axis],min=box[axis],max=min+box[axis==='x'?'width':'height'];if(delta===0){if(p[axis]<=min||p[axis]>=max)return false;}else{let a=(min-p[axis])/delta,b=(max-p[axis])/delta;if(a>b)[a,b]=[b,a];low=Math.max(low,a);high=Math.min(high,b);if(low>=high)return false;}}
 return high>0&&low<1;
}
export function evaluateGeometry(observation, profile={}) {
 const violations=[];let unknown=!verified(observation);const epsilon=profile.epsilonPx??0.5,minFont=profile.minFontPx??12;
 if(!Number.isFinite(epsilon)||epsilon<0||!Number.isFinite(minFont)||minFont<=0)unknown=true;
 const bounds=profile.bounds??observation?.bounds,nodes=(observation?.nodes??[]).filter(n=>n.visible===true),texts=(observation?.texts??[]).filter(n=>n.visible===true),edges=(observation?.edges??[]).filter(e=>e.visible===true);
 if(nodes.length===0||!validRect(bounds)||!Array.isArray(observation?.nodes)||!Array.isArray(observation?.texts)||!Array.isArray(observation?.edges))unknown=true;
 const usableNodes=nodes.filter(n=>validRect(n.rect));
 const all=[...nodes,...texts];
 for(const item of all){if(!validRect(item.rect)){unknown=true;continue;}if(validRect(bounds)&&!contains(bounds,item.rect,epsilon))violations.push({code:'clipping',id:item.id??item.nodeId,text:item.text});}
 for(const t of texts){if(!Number.isFinite(t.fontSize)){unknown=true;continue;}if(t.fontSize<minFont)violations.push({code:'tiny_font',text:t.text,fontSize:t.fontSize});}
 // Node font is a fallback for observers without separate glyph records, not a second defect.
 for(const n of nodes)if(!texts.some(t=>t.nodeId===n.id)&&n.fontSize!==undefined&&n.fontSize<minFont)violations.push({code:'tiny_font',id:n.id,fontSize:n.fontSize});
 const legal=(parent,child)=>contains(parent.rect,child.rect,epsilon)&&((child.parentId===parent.id&&child.containmentAllowed===true)||(observation?.containments??[]).some(c=>c.parent===parent.id&&c.child===child.id));
 for(let i=0;i<usableNodes.length;i++)for(let j=i+1;j<usableNodes.length;j++){const a=usableNodes[i],b=usableNodes[j],over=intersection(a.rect,b.rect);if(over.width>epsilon&&over.height>epsilon&&!legal(a,b)&&!legal(b,a))violations.push({code:'node_overlap',nodes:[a.id,b.id],severity:over.width*over.height/Math.min(a.rect.width*a.rect.height,b.rect.width*b.rect.height)});}
 const usableTexts=texts.filter(t=>validRect(t.rect));
 for(let i=0;i<usableTexts.length;i++){const t=usableTexts[i];for(let j=i+1;j<usableTexts.length;j++){const u=usableTexts[j],over=intersection(t.rect,u.rect);if(over.width>epsilon&&over.height>epsilon)violations.push({code:'text_overlap',texts:[t.text,u.text]});}
  const owner=usableNodes.find(n=>n.id===t.nodeId);if(owner&&!contains(owner.rect,t.rect,epsilon))violations.push({code:'label_outside_node',nodeId:t.nodeId,text:t.text});
  for(const n of usableNodes){if(n.id===t.nodeId|| (owner&&legal(n,owner)))continue;const over=intersection(t.rect,n.rect);if(over.width>epsilon&&over.height>epsilon)violations.push({code:'text_node_overlap',nodeId:n.id,text:t.text});}
 }
 for(const edge of edges){if(!Array.isArray(edge.points)||edge.points.length<2||edge.points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y))){unknown=true;continue;}
  if(validRect(bounds)&&edge.points.some(p=>p.x<bounds.x-epsilon||p.y<bounds.y-epsilon||p.x>bounds.x+bounds.width+epsilon||p.y>bounds.y+bounds.height+epsilon))violations.push({code:'edge_clipping',from:edge.from,to:edge.to});
  for(const n of usableNodes){if(n.id===edge.from||n.id===edge.to)continue;if(edge.points.slice(1).some((q,i)=>segmentInside(edge.points[i],q,n.rect,epsilon)))violations.push({code:'edge_node_intrusion',nodeId:n.id,from:edge.from,to:edge.to});}
 }
 if(unknown)violations.push({code:'incomplete_geometry'});
 const counts={};for(const v of violations)counts[v.code]=(counts[v.code]??0)+1;
 return {status:unknown?'unverified':'verified',passed:!unknown&&!violations.length,violations,metrics:{nodes:nodes.length,texts:texts.length,edges:edges.length,defects:violations.length,defectsPerNode:nodes.length?violations.length/nodes.length:null,counts,minFontPx:minFont,epsilonPx:epsilon,calibrated:profile.calibrated===true,pilot:profile.calibrated!==true}};
}
