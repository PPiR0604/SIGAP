import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SigapRepository} from '../src/db/repo.js';
import {validateAndCreateApproval,buildApprovedWritePayload,verifyToolExecutionAgainstGate} from '../src/approvals/gate.js';
test('storage conflicts require exact field choices bound to the approved write',async ()=>{
  const repo=new SigapRepository(':memory:');
  try{
    const session=repo.createSession();const batch=repo.createBatch({sessionId:session.session_id,requestId:'conflict',contextId:'test',sourceSha256:'a'.repeat(64),sourceLength:1,filteredText:'test',piiSummary:{}});
    const snapshot='1'.repeat(32),sha='a'.repeat(64);
    repo.saveSnapshot({snapshotId:snapshot,snapshotSha256:sha,batchId:batch.batch_id,version:1,qualityStatus:'PERLU_KLARIFIKASI',payload:{records:[{report_id:'R001',storage_conflicts:[{field:'total_people',previous_value:10,incoming_value:12}]}]}});
    repo.updateBatchStatus(batch.batch_id,'ready_for_review');
    const body={action:'approve_save' as const,snapshot_id:snapshot,partial_acknowledged:true,clear_decisions:{}};
    assert.equal((await validateAndCreateApproval(repo,batch,'tester',body)).code,'INCOMPLETE_CONFLICT_DECISIONS');
    assert.equal((await validateAndCreateApproval(repo,batch,'tester',{...body,conflict_decisions:{R001:{total_people:'keep',male:'incoming'}}})).code,'INVALID_CONFLICT_DECISIONS');
    const decision=(await validateAndCreateApproval(repo,batch,'tester',{...body,conflict_decisions:{R001:{total_people:'keep'}}}));
    assert.equal(decision.valid,true);const payload=buildApprovedWritePayload(decision.approval!);
    assert.deepEqual(payload.conflict_decisions,{R001:{total_people:'keep'}});
    assert.equal((await verifyToolExecutionAgainstGate(repo,batch.batch_id,'upsert_shelter',{...payload,conflict_decisions:{R001:{total_people:'incoming'}}})).allow,false);
    assert.equal((await verifyToolExecutionAgainstGate(repo,batch.batch_id,'upsert_shelter',payload)).allow,true);
  }finally{repo.close();}
});
