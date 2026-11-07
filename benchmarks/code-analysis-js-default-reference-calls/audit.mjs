// Supplemental signature audit. No project module, build or config is executed.
import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';import {createHash} from 'node:crypto';
const [moduleDirectory,rootArg,baselineFile,candidateFile,out]=process.argv.slice(2);if(!out)throw Error('Pass module directory, source root, baseline facts, candidate facts and output JSON.');
const require=createRequire(path.resolve(moduleDirectory,'package.json'));const ts=require('typescript');const root=path.resolve(rootArg),baseline=JSON.parse(fs.readFileSync(baselineFile)),candidate=JSON.parse(fs.readFileSync(candidateFile));
const key=c=>JSON.stringify([c.file,c.line,c.column,c.endLine,c.endColumn]);const old=new Map(baseline.calls.map(c=>[key(c),c]));const added=candidate.calls.filter(c=>c.target&&!old.get(key(c))?.target);const requests=new Map(added.map(c=>[key(c),c]));
for(const file of candidate.files)if(fs.readFileSync(path.join(root,file.path),'utf8')!==file.sourceText)throw Error('Source changed: '+file.path);
const options={allowJs:true,checkJs:true,noEmit:true,skipLibCheck:true,types:[],module:ts.ModuleKind.NodeNext,moduleResolution:ts.ModuleResolutionKind.NodeNext,target:ts.ScriptTarget.ESNext};
const program=ts.createProgram(candidate.files.map(f=>path.join(root,f.path)),options);const checker=program.getTypeChecker(),rows=[];
for(const source of program.getSourceFiles()){
 const file=path.relative(root,source.fileName).split(path.sep).join('/');
 function walk(node){if(ts.isCallExpression(node)){
  const start=source.getLineAndCharacterOfPosition(node.getStart(source)),end=source.getLineAndCharacterOfPosition(node.getEnd());const request=requests.get(key({file,line:start.line+1,column:start.character+1,endLine:end.line+1,endColumn:end.character+1}));
  if(request){const declaration=checker.getResolvedSignature(node)?.declaration;let target=null;
   if(declaration&&ts.isFunctionDeclaration(declaration)&&declaration.body){const owner=declaration.getSourceFile(),point=owner.getLineAndCharacterOfPosition(declaration.getStart(owner));target={file:path.relative(root,owner.fileName).split(path.sep).join('/'),name:declaration.name?.text??'default',line:point.line+1,column:point.character+1};}
   const status=target?JSON.stringify(target)===JSON.stringify(request.target)?'signature-agreed':'signature-disagreed':'signature-unavailable';rows.push({call:request,compilerTarget:target,status});requests.delete(key(request));
  }
 }ts.forEachChild(node,walk);}walk(source);
}
for(const call of requests.values())rows.push({call,status:'call-not-found'});
const diagnostics=ts.getPreEmitDiagnostics(program);const codes={};for(const d of diagnostics)codes[d.code]=(codes[d.code]||0)+1;
const report={typescript:ts.version,mode:'Supplemental full-resolution/checkJs signature audit, not successful compilation or runtime identity. Product uses a captured noResolve/noLib program; this audit uses live standard-host files after byte checks.',options,files:candidate.files.length,diagnosticCount:diagnostics.length,diagnosticCodes:codes,examples:diagnostics.slice(0,6).map(d=>({code:d.code,file:d.file?path.relative(root,d.file.fileName):null,message:ts.flattenDiagnosticMessageText(d.messageText,' ')})),counts:Object.fromEntries(['signature-agreed','signature-disagreed','signature-unavailable','call-not-found'].map(s=>[s,rows.filter(r=>r.status===s).length])),rows,sourceDigest:createHash('sha256').update(JSON.stringify(candidate.files.map(f=>[f.path,createHash('sha256').update(f.sourceText).digest('hex')]))).digest('hex')};fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({counts:report.counts,diagnostics:report.diagnosticCount}));if(report.counts['signature-disagreed']||report.counts['call-not-found'])process.exitCode=1;
