const graph = () => ({nodes:[],edges:[],status:'verified',unknownReasons:[]});
const unknown = (g, reason) => {g.status='unverified';g.unknownReasons.push(reason);return g;};
const plainText = value => {
 const fragment=parseFragment(String(value ?? ''));
 const text = n => n.nodeName==='#text' ? n.value : (n.childNodes ?? []).map(text).join(n.tagName==='br'?'\n':'');
 return text(fragment).trim();
};
function validate(g) {
 const ids=new Set();
 for(const n of g.nodes){if(typeof n.id!=='string'||!n.id||typeof n.label!=='string'||ids.has(n.id))unknown(g,'Missing or duplicate native node identity');ids.add(n.id);}
 for(const e of g.edges)if(!ids.has(e.from)||!ids.has(e.to))unknown(g,'Edge endpoints cannot be bound to native nodes');
 if(!g.nodes.length)unknown(g,'No native semantic nodes extracted');
 return g;
}
function archify(data,{type}) {
 const g=graph(); const kind=data.diagram_type ?? type;
 if(type && data.diagram_type && type!==data.diagram_type)return unknown(g,'Requested type differs from source');
 const collections={architecture:['components','connections'],workflow:['nodes','edges'],dataflow:['nodes','flows'],lifecycle:['states','transitions'],sequence:['participants','messages'],erd:['entities','relationships'],class:['types','relationships'],tree:['nodes',null],timeline:['events',null],waterfall:['spans',null]};
 if(!collections[kind])return unknown(g,'Unsupported Archify diagram type');
 const [nk,ek]=collections[kind];
 if(!Array.isArray(data[nk]) || (ek && data[ek]!==undefined&&!Array.isArray(data[ek])))return unknown(g,'Missing or invalid native collections');
 g.nodes=data[nk].map(n=>({...n,id:n.id,label:n.label ?? n.name ?? '',type:n.type}));
 g.edges=(data[ek]??[]).map((e,i)=>({...e,id:e.id??`edge-${i}`,from:e.from,to:e.to,label:e.label??''}));
 if(kind==='tree')for(const n of g.nodes)if(n.parent)g.edges.push({from:n.parent,to:n.id,label:''});
 if(['erd','class','tree','timeline','waterfall'].includes(kind))unknown(g,'Extension collection extracted; typed attributes, quantities or hierarchy are not fully verified');
 // Sequence message order is preserved as native y, but not reduced to unordered graph credit.
 if(kind==='sequence')g.edges.forEach((e,i)=>{e.order=i;e.y=data[ek][i].y;});
 return validate(g);
}
export function parseSource(format,source,options={}) {
 if(format!=='archify')throw new TypeError('This comparison accepts Archify sources only');
 try {return archify(typeof source==='string'?JSON.parse(source):source,options);}
 catch(error){return {nodes:[],edges:[],status:'invalid',unknownReasons:[error.message]};}
}
