import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { parse } from 'yaml';
const labels=['Architecture','Workflow','Sequence','Data flow','Lifecycle','ERD','Class','Tree','Timeline','Waterfall'];
for(const form of ['bug-report','showcase']) test(`${form} intake lets users identify every supported diagram type`,()=>{
 const source=fs.readFileSync(new URL(`../.github/ISSUE_TEMPLATE/${form}.yml`,import.meta.url),'utf8');
 const field=parse(source).body.find(item=>item.id==='diagram_type');
 assert.equal(field.type,'dropdown');
 for(const label of labels) assert.ok(field.attributes.options.includes(label),`${form} missing ${label}`);
 assert.equal(new Set(field.attributes.options).size,field.attributes.options.length);
});
