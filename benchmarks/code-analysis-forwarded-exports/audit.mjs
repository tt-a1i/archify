// Independent full-resolution Program (not the extractor's noResolve Program).
// Parses pinned source only; it does not emit or execute project code.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../archify/modules/code-analysis/package.json', import.meta.url));
const ts = require('typescript');
const [rootArg, baselinePath, candidatePath, out] = process.argv.slice(2);
const root = path.resolve(rootArg);
const baseline = JSON.parse(fs.readFileSync(baselinePath));
const candidate = JSON.parse(fs.readFileSync(candidatePath));
const key = c => JSON.stringify([c.file,c.line,c.column,c.endLine,c.endColumn]);
const before = new Map(baseline.calls.map(c=>[key(c),c]));
const additions = candidate.calls.filter(c=>c.target && !before.get(key(c))?.target);
function verifySources(){
 for(const file of candidate.files) if(fs.readFileSync(path.join(root,file.path),'utf8')!==file.sourceText) throw new Error(`Source drift: ${file.path}`);
}
verifySources();
const config = ts.readConfigFile(path.join(root,'tsconfig.json'),ts.sys.readFile);
if(config.error) throw new Error('Cannot read pinned tsconfig');
const parsed = ts.parseJsonConfigFileContent(config.config,ts.sys,root);
const program = ts.createProgram(candidate.files.map(f=>path.join(root,f.path)),{...parsed.options,allowJs:true,noEmit:true});
const checker = program.getTypeChecker();
const units = [];
for(const fact of additions){
 const source=program.getSourceFile(path.join(root,fact.file)); let selected;
 function visit(node){
  if(ts.isCallExpression(node)){
   const p=source.getLineAndCharacterOfPosition(node.getStart(source));
   if(p.line+1===fact.line && p.character+1===fact.column && node.getEnd()===source.getPositionOfLineAndCharacter(fact.endLine-1,fact.endColumn-1)) selected=node;
  }
  ts.forEachChild(node,visit);
 }
 if(source) visit(source);
 let symbol=selected && checker.getSymbolAtLocation(selected.expression);
 if(symbol && symbol.flags & ts.SymbolFlags.Alias) symbol=checker.getAliasedSymbol(symbol);
 const bodies=(symbol?.declarations||[]).filter(d=>ts.isFunctionDeclaration(d)&&d.body);
 let target=null;
 if(bodies.length===1){const d=bodies[0],s=d.getSourceFile(),p=s.getLineAndCharacterOfPosition(d.getStart(s));target={file:path.relative(root,s.fileName).split(path.sep).join('/'),name:d.name?.text||'default',line:p.line+1,column:p.character+1};}
 const signature=selected&&checker.getResolvedSignature(selected)?.declaration;
 const signaturePoint=signature?(()=>{const s=signature.getSourceFile(),p=s.getLineAndCharacterOfPosition(signature.getStart(s));return {file:path.relative(root,s.fileName),line:p.line+1,column:p.character+1,hasBody:!!signature.body};})():null;
 const status=target ? JSON.stringify(target)===JSON.stringify(fact.target)?'agree':'different':'unavailable';
 units.push({call:{file:fact.file,line:fact.line,column:fact.column},candidate:fact.target,compilerBody:target,signature:signaturePoint,status});
}
// Diagnostics remain separate: navigation agreement does not establish compilation.
const result={parser:ts.version,method:'Full TypeScript Program alias symbol -> unique function body; resolved overload signature recorded separately',projectExecuted:false,compilerDiagnostics:ts.getPreEmitDiagnostics(program).length,score:{agree:units.filter(u=>u.status==='agree').length,different:units.filter(u=>u.status==='different').length,unavailable:units.filter(u=>u.status==='unavailable').length},units};
verifySources();
fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result.score));
if(result.score.different)process.exitCode=1;
