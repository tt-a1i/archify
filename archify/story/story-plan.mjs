const unique = values => [...new Set(values)];
export const nativeMotions = ['relay', 'stream', 'sequence', 'walk', 'sweep', 'replay'];
export const openingModes = ['auto', 'fit', 'scan-x', 'scan-y'];
const required = (value, label) => {
  if (typeof value !== 'string' || !value.trim()) throw Error(label + ' needs text.');
  return value.trim();
};

function secondsFor(point) {
  if (point.seconds !== undefined) {
    if (!Number.isFinite(point.seconds) || point.seconds < 4) throw Error('Point seconds must be at least four.');
    return point.seconds;
  }
  const text = [point.title, point.text, point.meaning, point.caption].filter(Boolean).join(' ');
  const units = (text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu) || []).length
    + (text.match(/[\p{Script=Latin}\d]+/gu) || []).length * 1.8;
  return Math.max(7, Math.min(11, Math.ceil(2 + units / 10)));
}

export function compileBrief(brief, facts) {
  if (brief.version !== 2 || !Array.isArray(brief.scenes) || !brief.scenes.length) throw Error('A brief needs version 2 and scenes.');
  const nodes = new Map(facts.nodes.map(node => [node.id, node])), edges = new Map(facts.edges.map(edge => [edge.id, edge]));
  const title = required(brief.title, 'Title');
  if (brief.motion && !nativeMotions.includes(brief.motion)) throw Error('Unknown native motion choreography.');
  if(brief.scopeStyle&&brief.scopeStyle!=='field')throw Error('Unknown scope presentation.');
  if(brief.opening&&!openingModes.includes(brief.opening))throw Error('Opening must be auto, fit, scan-x or scan-y.');
  const intro = required(brief.intro, 'Intro'), outro = required(brief.outro, 'Outro');
  const shots = [{duration: 6, preset: 'establish', label: '', phase: -1, headline: title, caption: intro, nodes: [], edges: [], annotations: []}];
  for (const [index, scene] of brief.scenes.entries()) {
    const headline = required(scene.title, 'Scene title');
    if (!Array.isArray(scene.points) || !scene.points.length) throw Error('Every scene needs points.');
    if (scene.side && !['left', 'right'].includes(scene.side)) throw Error('Scene side must be left or right.');
    if (scene.preset && !['follow', 'inspect'].includes(scene.preset)) throw Error('Scene preset must be follow or inspect.');
    const focus = [...(scene.focus || [])], selectedEdges = [], edgeTimes = {}, edgeDurations = {}, edgeModes = {}, annotations = [], captions = [], views = [];
    let cursor = 1.55;
    for (const point of scene.points) {
      if (!nodes.has(point.anchor)) throw Error('Unknown point anchor ' + point.anchor);
      const heading = required(point.title, 'Point title'), body = required(point.text, 'Point text');
      const references = point.via ? (Array.isArray(point.via) ? point.via : [point.via]) : [];
      const related = references.map(id=>edges.has(id)?id:typeof id==='string'&&id.startsWith('edge:')?facts.edges.find(edge=>edge.key===id.slice(5))?.id||id:id);
      const action = point.action || scene.action || facts.defaultAction || 'trace', travel = point.travel ?? 1.1;
      if (!['trace', 'parallel', 'relation'].includes(action)) throw Error('Unknown point action.');
      if (!Number.isFinite(travel) || travel < .5 || travel > 3) throw Error('Travel must be between 0.5 and 3 seconds.');
      const motionSpan = related.length ? (action === 'trace' ? related.length * (travel + .2) : travel) : 0;
      const duration = Math.max(secondsFor(point), .65 + motionSpan + 1);
      const pointNodes=unique([...(scene.focus||[]),...(point.focus||[]),point.anchor,...related.flatMap(id=>{const edge=edges.get(id);if(!edge)throw Error('Unknown point connection '+id);return [edge.from,edge.to];})]);
      for(const id of pointNodes)if(!nodes.has(id))throw Error('Unknown point focus '+id);
      views.push({at:views.length?cursor-1.2:0,nodes:pointNodes,edges:related,note:annotations.length});
      for (const [order, id] of related.entries()) {
        const edge = edges.get(id);
        if (!edge) throw Error('Unknown point connection ' + id);
        if (selectedEdges.includes(id)) {
          if (action === 'relation' && edgeModes[id] === 'relation') continue;
          throw Error('Repeated connection in one scene; put its replay in another scene: ' + id);
        }
        selectedEdges.push(id); edgeTimes[id] = cursor + .65 + (action === 'trace' ? order * (travel + .2) : 0);
        edgeDurations[id] = travel; edgeModes[id] = action === 'relation' ? 'relation' : 'trace';
      }
      annotations.push({anchor: point.anchor, title: heading, body, ...(point.meaning ? {kindExplanation: point.meaning} : {}),
        relations: related, ...(point.figureCaption || point.figure ? {figureCaption: point.figureCaption || point.figure} : {}),
        ...(point.code ? {code:point.code} : {}), at: cursor, until: cursor + duration - .25,
        preferred: scene.side || 'right', ...(point.scopeText?{scopeText:point.scopeText}:{})});
      captions.push({at: captions.length ? cursor : 0, text: point.caption || heading});
      focus.push(point.anchor,...(point.focus||[])); cursor += duration;
    }
    const selectedNodes = unique([...focus, ...selectedEdges.flatMap(id => [edges.get(id).from, edges.get(id).to])]);
    for (const id of selectedNodes) if (!nodes.has(id)) throw Error('Unknown scene focus ' + id);
    shots.push({duration: cursor + .4, preset: scene.preset || 'follow', label: scene.label || headline, phase: index,
        headline, caption: captions[0].text, nodes: selectedNodes, edges: selectedEdges, annotations, captions, views, edgeTimes, edgeDurations, edgeModes});
  }
  shots.push({duration: 5, preset: 'resolve', label: '', phase: brief.scenes.length - 1, headline: brief.closingTitle || title,
    caption: outro, nodes: [], edges: [], annotations: []});
  return {version: 1, defaultMode: 'explain', title, eyebrow: brief.eyebrow || 'ARCHIFY',
    timing:{camera:1.2}, ...(brief.opening?{opening:brief.opening}:{}), ...(brief.scopeStyle?{scopeStyle:brief.scopeStyle}:{}), ...(brief.accent ? {accent: brief.accent} : {}), ...(brief.motion ? {motion: brief.motion} : {}), phases: brief.scenes.map(scene => ({label: scene.label || scene.title})), shots};
}

export function draftBrief(facts) {
  const groups = new Map();
  for (const node of facts.nodes) {
    const context = node.context || facts.title;
    if (!groups.has(context)) groups.set(context, []);
    groups.get(context).push(node);
  }
  return {version: 2, title: facts.title, intro: '', outro: '', scenes: [...groups].map(([title, nodes]) => ({title,
    points: nodes.map(node => ({anchor: node.id, title: node.label, text: ''}))}))};
}
