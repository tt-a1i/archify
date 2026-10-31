import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { verifyRepositoryEvidence } from '../archify/renderers/shared/repository-evidence.mjs';
import { fixture, git } from './helpers/repository-evidence-fixture.mjs';
test('repository evidence rejects annotated tag objects without changing commit identities',t=>{
  const data=fixture();t.after(()=>fs.rmSync(data.root,{recursive:true,force:true}));
  assert.equal(verifyRepositoryEvidence('architecture',data.diagram,data.root).verified,true);
  git(data.root,'-c','tag.gpgSign=false','tag','-a','v1','-m','fixture');
  data.diagram.meta.repository.revision=git(data.root,'rev-parse','refs/tags/v1');
  assert.throws(()=>verifyRepositoryEvidence('architecture',data.diagram,data.root),(error)=>{
    assert.match(error.message,/commit/i);
    assert.equal(error.archifyDiagnostics?.[0]?.code,'repository-evidence/revision-not-commit');
    return true;
  });
});
