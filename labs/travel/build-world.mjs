import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
export function buildWorld(check=false){
  const files=['maplibre-gl.mjs','maplibre-gl-shared.mjs','maplibre-gl-worker.mjs','maplibre-gl.css'];
  for(const name of [...files,'LICENSE.txt']){
    const source=path.join(root,'node_modules/maplibre-gl',name==='LICENSE.txt'?'LICENSE.txt':'dist/'+name),target=path.join(root,'vendor/maplibre',name);
    const bytes=fs.readFileSync(source);if(check){if(!fs.existsSync(target)||!fs.readFileSync(target).equals(bytes))throw Error('Stale world dependency: '+name);}else{fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);}
  }
}
