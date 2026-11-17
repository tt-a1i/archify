import fs from 'node:fs';
import path from 'node:path';
import {scanStory,draftStory,buildStory} from './tool.mjs';

function exportStorySvg(input, brief, output) {
  if (path.extname(output).toLowerCase() !== '.svg') throw Error('Story SVG output must use a .svg extension.');
  const temporary = path.join(path.dirname(output), `.${path.basename(output)}.html`);
  const built = buildStory(input, brief, temporary);
  const html = fs.readFileSync(temporary, 'utf8');
  const match = html.match(/<svg\b[^>]*>[\s\S]*?<\/svg>/);
  const style = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map(item => item[1]).filter(item => item.includes('@keyframes') || item.includes('animation:')).join('\n');
  fs.rmSync(temporary, { force: true });
  if (!match || !style) throw Error('The story did not contain one animated SVG.');
  const svg = match[0].replace(/(<svg\b[^>]*>)/, `$1<style>${style}</style>`);
  const external = svg.replaceAll('http://www.w3.org', '').match(/<script\b|https?:\/\/|url\(\s*['"]?(?:https?:|\/\/)/i);
  if (external) throw Error('The story SVG must stay self-contained: ' + svg.slice(Math.max(0, external.index - 50), external.index + 80).replace(/\s+/g, ' '));
  fs.writeFileSync(output, svg);
  const still = output.replace(/\.svg$/i, '.still.svg');
  fs.writeFileSync(still, svg.replace(/animation:[^;}]+/g, 'animation:none'));
  return { output, still, scenes: built.scenes ?? null };
}

export function commandStory(args){
  const json=args.includes('--json'),positional=[];let repoRoot,action;
  try{
    for(let index=0;index<args.length;index++){
      const value=args[index];
      if(value==='--json')continue;
      if(value==='--repo-root'){
        if(repoRoot||!args[index+1]||args[index+1].startsWith('--'))throw Error('--repo-root requires one repository path.');
        repoRoot=path.resolve(args[++index]);continue;
      }
      if(value.startsWith('--'))throw Error('Unknown story option '+value);
      positional.push(value);
    }
    [action]=positional;const input=positional[1];
    const count={scan:2,draft:3,attach:4,svg:4}[action];
    if(!count||positional.length!==count)throw Error('Use story scan <native.html>, story draft <native.html> <brief.json>, story attach <native.html> <brief.json> <enhanced.html>, or story svg <native.html> <brief.json> <story.svg>.');
    if(repoRoot&&action!=='attach')throw Error('--repo-root is supported for story attach code excerpts only.');
    const result=action==='svg'?exportStorySvg(path.resolve(input),path.resolve(positional[2]),path.resolve(positional[3])):action==='scan'?scanStory(path.resolve(input)):action==='draft'?draftStory(path.resolve(input),path.resolve(positional[2])):buildStory(path.resolve(input),path.resolve(positional[2]),path.resolve(positional[3]),{repoRoot});
    if(json||action==='scan')console.log(JSON.stringify({ok:true,command:'story',action,...result},null,2));
    else if(action==='draft')console.log('Brief: '+result.brief+'\nSource map: '+result.sourceMap);
    else console.log(result.output);
    return result;
  }catch(error){
    const diagnostics=error.archifyDiagnostics||[error.diagnostic||{code:'story/invalid-input',severity:'error',message:error.message,subject:{action,input:positional[1]&&path.resolve(positional[1]),...(positional[2]?{brief:path.resolve(positional[2])}:{})},evidence:{reason:error.code||error.message},supportedFixes:['Use the original native Archify HTML, valid source IDs and a distinct output path; read references/story-authoring.md.']}];
    if(json)console.log(JSON.stringify({ok:false,command:'story',action,diagnostics},null,2));else console.error(error.message);
    process.exitCode=1;
  }
}
