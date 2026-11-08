import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {extractFacts,loadConfig} from '../lib/analysis.mjs';
import {buildQuestion} from '../lib/explain.mjs';
import {captureChangeSide,buildChangeQuestion} from '../lib/change-question.mjs';
import {schemaErrors} from '../extract/shared/schema.mjs';
const ns=' xmlns="http://maven.apache.org/POM/4.0.0"';
const parent='<parent><groupId>p</groupId><artifactId>parent</artifactId><version>1</version><relativePath>../parent-pom.xml</relativePath></parent>';
function fixture(t,{main=false,jar=true,testJar=true,version='1',profile='',excludeParent=false}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'archify-java-projects-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const files={
  'pom.xml':'<project'+ns+'><groupId>p</groupId><artifactId>root</artifactId><version>1</version><packaging>pom</packaging><modules><module>caller</module><module>api</module><module>other</module></modules><dependencyManagement><dependencies><dependency><groupId>p</groupId><artifactId>api</artifactId><version>1</version></dependency></dependencies></dependencyManagement></project>',
  'parent-pom.xml':'<project'+ns+'><parent><groupId>p</groupId><artifactId>root</artifactId><version>1</version><relativePath>pom.xml</relativePath></parent><artifactId>parent</artifactId><packaging>pom</packaging></project>',
  'api/pom.xml':'<project'+ns+'>'+parent+'<artifactId>api</artifactId></project>',
  'other/pom.xml':'<project'+ns+'>'+parent+'<artifactId>other</artifactId></project>',
  'caller/pom.xml':'<project'+ns+'>'+parent+'<artifactId>caller</artifactId><dependencies>'+
   (jar?'<dependency><groupId>p</groupId><artifactId>api</artifactId><version>'+version+'</version></dependency>':'')+
   (testJar?'<dependency><groupId>p</groupId><artifactId>api</artifactId><version>1</version><type>test-jar</type><scope>test</scope></dependency>':'')+
   '</dependencies>'+profile+'</project>',
  'api/src/main/java/p/Api.java':'package p; public class Api { public static void run(){} }',
  'api/src/test/java/q/Parent.java':'package q; public class Parent {}',
  ['caller/src/'+(main?'main':'test')+'/java/q/Calls.java']:'package q; import p.Api; public class Calls extends Parent {public void go(){Api.run();}}',
 };
 for(const[file,text]of Object.entries(files)){fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.writeFileSync(path.join(root,file),text)}
 const config=loadConfig();config.include=['**/*.java'];if(excludeParent)config.exclude.push('parent-pom.xml');
 return {root,config,entry:'caller/src/'+(main?'main':'test')+'/java/q/Calls.java'};
}
test('declared jar and test-jar routes support captured main target and test parent, including named local parents',t=>{
 const args=fixture(t);const {facts}=extractFacts(args.root,{language:'java',config:args.config});
 assert.deepEqual(schemaErrors('raw-facts',facts),[]);assert.equal(facts.callModel,'java-static-lexical-v5');
 const bad=structuredClone(facts);bad.languageScope.metadata[0].sourceText+='changed';assert.ok(schemaErrors('raw-facts',bad).some(e=>String(e.message).includes('hash')));
 const absent=structuredClone(facts);delete absent.languageScope;assert.equal(buildQuestion({...args,facts:absent,symbol:'Calls.go()',question:'Can missing project inputs establish coverage?'}).calls.coverage,'unavailable');
 const call=facts.calls[0];assert.equal(call.target.file,'api/src/main/java/p/Api.java');
 assert.equal(call.qualifierAncestry[0].file,'api/src/test/java/q/Parent.java');
 assert.deepEqual(new Set(call.buildEvidence.map(p=>p.file)),new Set(['caller/pom.xml','parent-pom.xml','pom.xml','api/pom.xml']));
 assert.equal(facts.files.length,3);assert.ok(!facts.files.some(f=>f.path.endsWith('.xml')));
 const q=buildQuestion({...args,facts,symbol:'Calls.go()',question:'Which declared project source is this static call candidate?'});
 assert.equal(q.calls.records[0].targetNavigation.status,'valid');
 assert.equal(q.calls.records[0].targetNavigation.buildEvidence.length,4);
 fs.appendFileSync(path.join(args.root,'parent-pom.xml'),'\n<!-- changed -->');
 const stale=buildQuestion({...args,facts,symbol:'Calls.go()',question:'Are the same build inputs still present?'});
 assert.equal(stale.entry.factsStatus,'resolution-input-changed');assert.equal(stale.calls.coverage,'unavailable');
});
test('main/test roles, dependency kind/version, missing parent and conditional dependencies cannot grant a cross-project target',t=>{
 for(const options of [{main:true},{jar:false},{testJar:false},{version:'2'},{excludeParent:true},{profile:'<profiles><profile><id>x</id><dependencies><dependency><groupId>p</groupId><artifactId>other</artifactId><version>1</version></dependency></dependencies></profile></profiles>'}]){
  const args=fixture(t,options),{facts}=extractFacts(args.root,{language:'java',config:args.config});assert.deepEqual(schemaErrors('raw-facts',facts),[]);
  assert.equal(facts.calls[0].resolution,'unresolved');assert.equal(facts.calls[0].reason,'java-inherited-build-scope');
 }
});
test('reactor co-location without a dependency does not select sibling source, while inherited dependency management resolves project version',t=>{
 const args=fixture(t);const caller=path.join(args.root,'caller/pom.xml');
 let pom=fs.readFileSync(caller,'utf8');pom=pom.replace('<version>1</version></dependency>','</dependency>');fs.writeFileSync(caller,pom);
 let result=extractFacts(args.root,{language:'java',config:args.config});assert.ok(result.facts.calls[0].target);
 fs.writeFileSync(caller,pom.replace(/<dependencies>.*<\/dependencies>/,''));
 result=extractFacts(args.root,{language:'java',config:args.config});assert.equal(result.facts.calls[0].resolution,'unresolved');
});
test('paired declared dependency references keep BOM metadata fresh and disable navigation after a parent input changes',t=>{
 const args=fixture(t);const pom=path.join(args.root,'parent-pom.xml');fs.writeFileSync(pom,'\uFEFF'+fs.readFileSync(pom,'utf8'));
 const head=fs.mkdtempSync(path.join(os.tmpdir(),'archify-java-projects-head-'));t.after(()=>fs.rmSync(head,{recursive:true,force:true}));fs.cpSync(args.root,head,{recursive:true});
 const api=path.join(head,'api/src/main/java/p/Api.java');fs.writeFileSync(api,fs.readFileSync(api,'utf8').replace('void run(){}','void run(){int changed=1;}'));
 const base=captureChangeSide(args.root,args.config,'java'),capture=captureChangeSide(head,args.config,'java');
 const input={base,head:capture,config:args.config,entry:'api/src/main/java/p/Api.java',question:'Which declared project callers refer to this changed source implementation?'};
 const fresh=buildChangeQuestion(input);assert.equal(fresh.status,'ready');
 const change=fresh.changedDefinitions.items.find(item=>item.head.definition.name==='run');assert.ok(change);
 for(const side of ['base','head'])assert.equal(change[side].knownReferences.total,1);
 fs.appendFileSync(path.join(head,'parent-pom.xml'),'\n<!-- changed after capture -->');
 const stale=buildChangeQuestion(input);assert.equal(stale.status,'partial');
 const ref=stale.changedDefinitions.items.find(item=>item.head.definition.name==='run').head.knownReferences.items[0];assert.equal(ref.navigation.status,'resolution-input-changed');assert.equal(ref.navigation.location,null);
});
test('an inherited profile property that changes a nested dependency version cannot establish a default project route',t=>{
 const args=fixture(t,{version:'${route}'}),caller=path.join(args.root,'caller/pom.xml');
 fs.writeFileSync(caller,fs.readFileSync(caller,'utf8').replace('<artifactId>caller</artifactId>','<artifactId>caller</artifactId><properties><route>${chosen}</route><chosen>1</chosen></properties>'));
 assert.ok(extractFacts(args.root,{language:'java',config:args.config}).facts.calls[0].target);
 const parent=path.join(args.root,'parent-pom.xml');fs.writeFileSync(parent,fs.readFileSync(parent,'utf8').replace('</project>','<profiles><profile><id>alternate</id><properties><chosen>2</chosen></properties></profile></profiles></project>'));
 const {facts}=extractFacts(args.root,{language:'java',config:args.config});
 assert.equal(facts.calls[0].resolution,'unresolved');assert.equal(facts.calls[0].reason,'java-inherited-build-scope');
 assert.ok(facts.languageScope.unknowns.some(p=>p.file==='caller/pom.xml' && p.detail.includes('conditional')));
});

test('unresolved explicit scope, type or classifier properties cannot silently become default jar visibility',t=>{
 for(const field of ['scope','type','classifier']){
  const args=fixture(t),caller=path.join(args.root,'caller/pom.xml');
  assert.ok(extractFacts(args.root,{language:'java',config:args.config}).facts.calls[0].target);
  fs.writeFileSync(caller,fs.readFileSync(caller,'utf8').replace('<version>1</version></dependency>','<version>1</version><'+field+'>${missing}</'+field+'></dependency>'));
  const {facts}=extractFacts(args.root,{language:'java',config:args.config});assert.equal(facts.calls[0].resolution,'unresolved');
  assert.ok(facts.languageScope.unknowns.some(p=>p.file==='caller/pom.xml' && p.detail.includes('unresolved or empty dependency field')));
 }
});
