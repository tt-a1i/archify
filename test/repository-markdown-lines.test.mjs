import test from 'node:test';
import assert from 'node:assert/strict';
import { repositorySourceHref } from '../archify/renderers/shared/repository-location.mjs';
test('GitHub Markdown line citations use plain source and preserve other links',()=>{
  const url='https://github.com/example/repo',rev='a'.repeat(40);
  for(const name of ['README.md','guide.MARKDOWN']) assert.equal(repositorySourceHref('github',url,rev,{path:name,line:1,endLine:3}),`${url}/blob/${rev}/${name}?plain=1#L1-L3`);
  assert.equal(repositorySourceHref('github',url,rev,{path:'README.md'}),`${url}/blob/${rev}/README.md`);
  assert.equal(repositorySourceHref('github',url,rev,{path:'a.js',line:2}),`${url}/blob/${rev}/a.js#L2`);
  assert.equal(repositorySourceHref('gitee',url,rev,{path:'README.md',line:2}),`${url}/blob/${rev}/README.md#L2`);
});
