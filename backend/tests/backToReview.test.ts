import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SigapRepository} from '../src/db/repo.js';
import {validateAndCreateApproval} from '../src/approvals/gate.js';

test('returning to review cannot resurrect invalid, completed or uncertain write results',async()=>{
 const repo=new SigapRepository();try{
  const session=repo.createSession(),batch=repo.createBatch({sessionId:session.session_id,contextId:session.context_id,requestId:'back',sourceSha256:'fixture',sourceLength:1,filteredText:'fixture',piiSummary:{}});
  for(const status of ['payload_invalid','failed','done','save_status_unknown','split_for_review','saving','verifying','processing']){
   repo.updateBatchStatus(batch.batch_id,status);
   const result=await validateAndCreateApproval(repo,batch,'fixture',{action:'back_to_review',snapshot_id:'1'.repeat(32),partial_acknowledged:false,clear_decisions:{}});
   assert.equal(result.valid,false);assert.equal(repo.getBatch(batch.batch_id)!.status,status);
  }
 }finally{repo.close();}
});

test('returning to review revokes pending approvals without reverting an in-flight newer status',async()=>{
 const repo=new SigapRepository();try{
  const session=repo.createSession(),batch=repo.createBatch({sessionId:session.session_id,contextId:session.context_id,requestId:'back',sourceSha256:'fixture',sourceLength:1,filteredText:'fixture',piiSummary:{}});
  repo.saveSnapshot({snapshotId:'1'.repeat(32),snapshotSha256:'a'.repeat(64),batchId:batch.batch_id,version:1,qualityStatus:'OK',payload:{records:[{report_id:'R001',total_people:0}]}});
  const approve=()=>repo.createApproval({batchId:batch.batch_id,actorId:'fixture',action:'approve_save',snapshotId:'1'.repeat(32),snapshotSha256:'a'.repeat(64)});
  approve();
  const back=await validateAndCreateApproval(repo,batch,'fixture',{action:'back_to_review',snapshot_id:'1'.repeat(32),partial_acknowledged:false,clear_decisions:{}});
  assert.equal(back.valid,true);assert.equal(repo.getPendingApprovalForSnapshot(batch.batch_id,'1'.repeat(32)),null);assert.equal(repo.getBatch(batch.batch_id)!.status,'ready_for_review');
  approve();let revoked=0;
  const revoke=repo.revokeApprovals.bind(repo);
  repo.revokeApprovals=id=>{revoked++;revoke(id);repo.updateBatchStatus(id,'saving');};
  const result=await validateAndCreateApproval(repo,batch,'fixture',{action:'back_to_review',snapshot_id:'1'.repeat(32),partial_acknowledged:false,clear_decisions:{}});
  assert.equal(result.valid,false);assert.equal(result.code,'WRITE_IN_PROGRESS');assert.equal(revoked,1);assert.equal(repo.getBatch(batch.batch_id)!.status,'saving');
 }finally{repo.close();}
});
