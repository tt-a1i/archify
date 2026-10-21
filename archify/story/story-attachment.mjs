import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse} from './vendor/html-parser.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
export function attachStory(nativeHtml,storyHtml){
  if(/id=["']archify-story-payload["']/.test(nativeHtml))throw Error('This HTML already contains a story; use the original native HTML to rebuild.');
  const document=parse(nativeHtml,{sourceCodeLocationInfo:true});
  const body=document.childNodes.find(node=>node.tagName==='html')?.childNodes.find(node=>node.tagName==='body');
  const at=body?.sourceCodeLocation?.endTag?.startOffset;
  if(at===undefined)throw Error('The native HTML needs a body element.');
  const payload=JSON.stringify({version:1,html:Buffer.from(storyHtml).toString('base64'),messages:JSON.parse(fs.readFileSync(path.join(here,'messages.json'),'utf8'))});
  const addon='<style id="archify-story-attachment-style">'+fs.readFileSync(path.join(here,'story-attachment.css'),'utf8')+'</style><script id="archify-story-payload" type="application/json">'+payload+'</script><script>'+fs.readFileSync(path.join(here,'story-attachment.js'),'utf8')+'</script>';
  return nativeHtml.slice(0,at)+addon+nativeHtml.slice(at);
}
