// Add ownership fields behind the existing relationship illustrations.
globalThis.StoryScopeField = (() => {
  const NS='http://www.w3.org/2000/svg';let serial=0;
  const make=(tag,attrs,parent)=>{const node=document.createElementNS(NS,tag);for(const [key,value]of Object.entries(attrs))node.setAttribute(key,value);parent?.append(node);return node;};
  const contains=(outer,inner)=>inner.x>=outer.x-1&&inner.y>=outer.y-1&&inner.x+inner.width<=outer.x+outer.width+1&&inner.y+inner.height<=outer.y+outer.height+1&&outer.width*outer.height>inner.width*inner.height+1;
  function decorate({figure,scopes,source}){
    let applied=false;
    for(const drawing of figure.querySelectorAll('svg')){
      const cards=[...drawing.querySelectorAll('[data-figure-node-id]')];
      const selected=scopes.filter(scope=>cards.some(card=>scope.members.includes(card.dataset.figureNodeId))).sort((a,b)=>b.width*b.height-a.width*a.height);
      if(!selected.length)continue;
      const prefix='scope-field-'+serial++,defs=make('defs',{}),background=make('g',{'data-scope-fields':''});
      drawing.prepend(defs,background);drawing.classList.add('scope-illustrated');applied=true;
      const maxDepth=Math.max(...selected.map(scope=>selected.filter(other=>contains(other,scope)).length));
      for(const [index,scope]of selected.entries()){
        const frame=[...source.querySelectorAll('[data-composition-frame-id]')].find(node=>node.dataset.compositionFrameId===scope.id&&node.dataset.compositionFrameKind===scope.kind&&node.dataset.graphRole!=='structural-frame-label');
        const shape=frame?.matches('rect,path,polygon')?frame:frame?.querySelector('rect,path,polygon');
        if(!shape)continue;
        const style=getComputedStyle(shape),color=style.stroke!=='none'?style.stroke:style.fill;
        const members=cards.filter(card=>scope.members.includes(card.dataset.figureNodeId));
        const left=Math.min(...members.map(card=>Number(card.getAttribute('x')))),right=Math.max(...members.map(card=>Number(card.getAttribute('x'))+Number(card.getAttribute('width'))));
        const top=Math.min(...members.map(card=>Number(card.getAttribute('y')))),bottom=Math.max(...members.map(card=>Number(card.getAttribute('y'))+Number(card.getAttribute('height'))));
        const depth=selected.filter(other=>contains(other,scope)).length;
        const gradient=make('radialGradient',{id:prefix+'-'+index},defs);
        make('stop',{offset:0,'stop-color':color,'stop-opacity':'.16'},gradient);
        make('stop',{offset:'.65','stop-color':color,'stop-opacity':'.065'},gradient);
        make('stop',{offset:1,'stop-color':color,'stop-opacity':0},gradient);
        make('ellipse',{cx:(left+right)/2,cy:(top+bottom)/2,rx:(right-left)/2+26,ry:(bottom-top)/2+34,fill:`url(#${prefix}-${index})`},background);
        const label=make('text',{x:left,y:Math.min(-6,top-13)-(maxDepth-depth)*19,fill:color,'font-size':7.2,'font-weight':500},background);
        const words=(scope.label||scope.kind).split(/\s+/),limit=Math.max(18,Math.floor((right-left)/4));let line='',row=0;
        for(const word of words){if(line&&line.length+word.length+1>limit){const span=make('tspan',{x:left,dy:row++?8.5:0},label);span.textContent=line;line=word;}else line+=(line?' ':'')+word;}
        const span=make('tspan',{x:left,dy:row?8.5:0},label);span.textContent=line;
      }
    }
    return applied;
  }
  return {decorate};
})();
