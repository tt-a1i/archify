/** Order-preserving twelve-column packing. Explicit spans never change.
 * A panel may shrink from its preferred width to its minimum to finish the current row,
 * so a wide panel does not strand the conclusion on a row of its own.
 */
export function layoutExplainerPanels(document, diagrams = {}) {
  const contentSize = value => typeof value === 'string' ? Array.from(value).length : Array.isArray(value) ? value.reduce((n,v)=>n+contentSize(v),0) : value && typeof value === 'object' ? Object.entries(value).filter(([key])=>!['id','type','span','target','source','diagramType','path','url','revision'].includes(key)).reduce((n,[,v])=>n+contentSize(v),0) : 0;
  const widths = block => {
    if (block.type === 'comparison') return block.columns.length + 1 > 3 ? [8,7] : [7,6];
    if (['code','diff'].includes(block.type)) return [8,7];
    if (block.type === 'chart') return [6,5];
    if (block.type === 'snippet') { const longest = Math.max(...block.text.split('\n').map(line => line.length)); return longest > 72 ? [8,7] : longest > 48 ? [6,6] : [5,4]; }
    if (block.type === 'diagram') {
      const diagram=diagrams[block.id], viewBox=diagram?.svg?.match(/viewBox=["']([^"']+)["']/)?.[1].split(/[ ,]+/).map(Number);
      return (viewBox?.[2] || diagram?.spec?.meta?.canvas?.width || 0) > 1000 ? [12,12] : [8,8];
    }
    return [4,4];
  };
  const sized = panel => panel.blocks.map(widths).reduce((best,next)=>next[0]>best[0]?next:best,[4,4]);
  const items=[{id:'answer',span:document.answer.span ?? 5,min:document.answer.span ?? 4,explicit:document.answer.span!==undefined,weight:contentSize(document.answer),answer:true},...document.panels.map(panel=>{const [span,min]=sized(panel);return{id:panel.id,span:panel.span ?? span,min:panel.span ?? min,explicit:panel.span!==undefined,weight:contentSize(panel),panel};})];
  const rows=[];let row=[],used=0;
  function finish(){if(!row.length)return;const remaining=12-used;const flexible=row.filter(item=>!item.explicit).sort((a,b)=>b.weight-a.weight);if(remaining&&flexible.length)flexible[0].span+=remaining;else if(remaining)row.push({spacer:true,span:remaining});rows.push(row);row=[];used=0;}
  for(const item of items){
    if(used+item.span>12){
      if(row.length&&row.reduce((n,x)=>n+x.min,0)+item.min<=12){
        let deficit=used+item.span-12;
        const cut=x=>{const d=Math.min(deficit,x.span-x.min);x.span-=d;deficit-=d;};
        cut(item);for(const x of [...row].sort((a,b)=>(b.span-b.min)-(a.span-a.min)))cut(x);
        used=row.reduce((n,x)=>n+x.span,0);
      } else finish();
    }
    row.push(item);used+=item.span;if(used===12)finish();
  }
  finish();
  return rows;
}
