import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { extractFacts, loadConfig } from '../lib/analysis.mjs';
import { buildQuestion } from '../lib/explain.mjs';
import { captureChangeSide, buildChangeQuestion } from '../lib/change-question.mjs';
import { schemaErrors } from '../extract/shared/schema.mjs';

function fixture(t, files) {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-java-qualified-'));
 t.after(() => fs.rmSync(root, { recursive: true, force: true }));
 for (const [file,text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root,file)), { recursive:true }); fs.writeFileSync(path.join(root,file),text); }
 return root;
}
const api = 'package p; public class Api { public static void run(){} public static void args(String s){} }';
const capture = root => { const {facts}=extractFacts(root,{language:'java'});assert.deepEqual(schemaErrors('raw-facts',facts),[]);return facts; };

test('Java explicit imported, same-package and full class paths navigate across files',t=>{
 const root=fixture(t,{'p/Api.java':api,'q/Calls.java':'package q; import p.Api; public class Calls { public void caller(){Api.run();p.Api.args("😀");} }','p/Local.java':'package p; public class Local { public void caller(){Api.run();} }'});
 const facts=capture(root);assert.equal(facts.callModel,'java-static-lexical-v2');assert.equal(facts.calls.length,3);
 assert.ok(facts.calls.every(c=>c.resolution==='java-qualified-static-method'&&c.target.file==='p/Api.java'));
 const q=buildQuestion({root,facts,entry:'q/Calls.java',symbol:'Calls.caller()',question:'Where is the implementation?'});
 assert.equal(q.calls.bindingCoverage,'top-level-class-and-explicit-qualified-static-source-candidates');assert.ok(q.calls.records.every(r=>r.targetNavigation.status==='valid'));
 fs.appendFileSync(path.join(root,'p/Api.java'),'// changed\n');
 const stale=buildQuestion({root,facts,entry:'q/Calls.java',symbol:'Calls.caller()',question:'Still current?'});
 assert.ok(stale.calls.records.every(r=>r.targetNavigation.status!=='valid'));
});

test('Java expression values and uncertain caller scopes never become imported class targets',t=>{
 const root=fixture(t,{'p/Api.java':api,'p/Other.java':'package p; public class Other { public static void run(){} }','p/Values.java':'package p; public class Values { public static Other Api; }','q/Static.java':'package q; import p.Api; import static p.Values.Api; public class Static { public void call(){Api.run();} }','q/Wildcard.java':'package q; import p.Api; import static p.Values.*; public class Wildcard { public void call(){Api.run();} }','q/Calls.java':`package q; import p.Api; import p.Other;
public class Calls {
 public void good(){Api.run();}
 public void parameter(Other Api){Api.run();}
 public void local(){Other Api=null;Api.run();}
 public void pattern(Object x){if(x instanceof Other Api){Api.run();}}
 public void lambda(){java.util.function.Consumer<Other> c=Api->Api.run();}
 public void packageValue(Other p){p.Api.run();}
}
class Field { static Other Api; public void run(){Api.run();} }
class Inherited extends Other { public void run(){Api.run();} }
`});const facts=capture(root);
 assert.equal(facts.calls.filter(c=>c.target).length,1);assert.equal(facts.calls.find(c=>c.target).line,3);
});

test('Java qualified methods keep overload, visibility, varargs, supertype and duplicate owner gaps unknown',t=>{
 const root=fixture(t,{'p/Api.java':`package p; public class Api {
 public static void over(){} public static void over(int x){}
 private static void secret(){} public void instance(){} public static void spread(String... args){}
}`,'q/Calls.java':'package q; import p.Api; public class Calls { public void call(){Api.over();Api.secret();Api.instance();Api.spread();} }'});
 const facts=capture(root);assert.ok(facts.calls.every(c=>!c.target));assert.equal(facts.calls[0].reason,'ambiguous-binding');
 fs.writeFileSync(path.join(root,'p/Api.java'),api);fs.mkdirSync(path.join(root,'duplicate'));fs.writeFileSync(path.join(root,'duplicate/Api.java'),api);
 fs.writeFileSync(path.join(root,'q/Calls.java'),'package q; import p.Api; public class Calls { public void call(){Api.run();} }');
 assert.ok(capture(root).calls.every(c=>!c.target));
});

test('Java paired changed definition recovers captured foreign callers and v1 stays a distinct model',t=>{
 const files={'p/Api.java':api,'q/Calls.java':'package q; import p.Api; public class Calls { public void call(){Api.run();} }'};
 const root=fixture(t,files),headRoot=fixture(t,{...files,'p/Api.java':api.replace('void run(){}','void run(){int changed=1;}')});
 const config=loadConfig();const base=captureChangeSide(root,config,'java'),head=captureChangeSide(headRoot,config,'java');
 const paired=buildChangeQuestion({question:'Which known references reach this change?',entry:'p/Api.java',base,head,config});
 const changed=paired.changedDefinitions.items.find(item=>item.head?.definition.name==='run');
 for(const side of ['base','head']){assert.equal(changed[side].knownReferences.total,1);assert.equal(changed[side].knownReferences.items[0].fact.file,'q/Calls.java');assert.equal(changed[side].knownReferences.items[0].navigation.status,'valid');}
 const historical=capture(root);historical.callModel='java-static-lexical-v1';
 assert.ok(schemaErrors('raw-facts',historical).some(e=>e.message.includes('Java v2')));
 historical.calls=historical.calls.map(({target,...call})=>({...call,resolution:'unresolved',reason:'unsupported-callee'}));
 assert.deepEqual(schemaErrors('raw-facts',historical),[]);
 const q=buildQuestion({root,facts:historical,entry:'q/Calls.java',question:'Historical coverage?'});assert.equal(q.calls.coverage,'available');assert.equal(q.calls.bindingCoverage,'top-level-class-unique-static-fixed-arity-source-candidates');
});
