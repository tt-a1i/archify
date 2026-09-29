import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.geojson':'application/geo+json','.json':'application/json','.txt':'text/plain; charset=utf-8'};
export function createServer(){return http.createServer((req,res)=>{
  try{let name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(name==='/')name='/index.html';
    const file=path.resolve(root,'.'+name);if(!file.startsWith(root+path.sep)||!types[path.extname(file)]||name.includes('node_modules')||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
    res.writeHead(200,{'Content-Type':types[path.extname(file)],'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});fs.createReadStream(file).pipe(res);
  }catch{res.writeHead(400);res.end();}
});}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))createServer().listen(Number(process.env.PORT||4319),'127.0.0.1',()=>console.log('Travel world preview: http://127.0.0.1:'+(process.env.PORT||4319)+'/world.html'));
