import path from 'node:path';
import {scanStory,draftStory,buildStory} from './tool.mjs';

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
    const count={scan:2,draft:3,attach:4}[action];
    if(!count||positional.length!==count)throw Error('Use story scan <native.html>, story draft <native.html> <brief.json>, or story attach <native.html> <brief.json> <enhanced.html>.');
    if(repoRoot&&action!=='attach')throw Error('--repo-root is supported for story attach code excerpts only.');
    const result=action==='scan'?scanStory(path.resolve(input)):action==='draft'?draftStory(path.resolve(input),path.resolve(positional[2])):buildStory(path.resolve(input),path.resolve(positional[2]),path.resolve(positional[3]),{repoRoot});
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
