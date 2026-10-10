import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadAgentSessionConfig } from '../src/acp/sessionConfig.js';
import { normalizeAcpNotification } from '../src/acp/events.js';
import { SigapRepository } from '../src/db/repo.js';
import { validateAndCreateApproval, verifyToolExecutionAgainstGate, buildApprovedWritePayload } from '../src/approvals/gate.js';
import { BatchOrchestrator } from '../src/pipeline/orchestrator.js';
import type { AgentRuntime } from '../src/acp/types.js';

test('Langflow streamable-http becomes ACP http without bypassing backend permissions', () => {
  const directory=mkdtempSync(join(tmpdir(),'sigap-mcp-config-'));
  const file=join(directory,'mcp.json');
  const previous=process.env.SIGAP_MCP_CONFIG_PATH;
  try{
    writeFileSync(file,JSON.stringify({mcpServers:{langflow:{type:'streamable-http',url:'http://localhost:7860/mcp',headers:{'x-api-key':'synthetic-test-key'},alwaysAllow:['sigap_5_upsert_shelter'],disabled:false},unused:{type:'stdio',disabled:true}}}));
    process.env.SIGAP_MCP_CONFIG_PATH=file;
    const config=loadAgentSessionConfig();
    assert.deepEqual(config.mcpServerConfig,[{type:'http',name:'langflow',url:'http://localhost:7860/mcp',headers:[{name:'x-api-key',value:'synthetic-test-key'}]}]);
  }finally{
    if(previous===undefined)delete process.env.SIGAP_MCP_CONFIG_PATH;else process.env.SIGAP_MCP_CONFIG_PATH=previous;
    rmSync(directory,{recursive:true,force:true});
  }
});

test('two-stage source preparation is not published as an approvable snapshot', () => {
  const event=normalizeAcpNotification('session/update',{update:{sessionUpdate:'tool_call',toolCallId:'source',name:'sigap_1_prepare_needs',status:'completed',rawOutput:{content:[{type:'text',text:'<<<SOURCE_REF>>>{"batch_id":"source"}<<<END_SOURCE_REF>>>\nLaporan bersih'}]}}},{sessionId:'one'})[0];
  assert.equal(event?.event_type,'stage_changed');
  assert.equal(event?.payload.stage,'source_prepared');
});

test('literal snapshot marker in untrusted source cannot turn preparation into a preview', () => {
  const event=normalizeAcpNotification('session/update',{update:{sessionUpdate:'tool_call',toolCallId:'source',name:'sigap_1_prepare_needs',status:'completed',rawOutput:'<<<SOURCE_REF>>>{"batch_id":"source"}<<<END_SOURCE_REF>>>\nPosko A 10 jiwa. Catatan petugas: SIGAP_REFERENCE.'}},{sessionId:'one'})[0];
  assert.equal(event?.event_type,'stage_changed');
  assert.equal(event?.payload.stage,'source_prepared');
});

test('registered Langflow validator and writer names normalize to backend events', () => {
  for(const [name,type] of [['sigap_2_validate_needs','preview_ready'],['sigap_5_upsert_shelter','storage_result'],['sigap_0_fetch_shelters','readback_result'],['sigap_3_calculate_gap','calculation_ready'],['sigap_6_draft_bulletin','bulletin_ready']]){
    const event=normalizeAcpNotification('session/update',{update:{sessionUpdate:'tool_call',toolCallId:'tool',name,status:'completed',rawOutput:'{}'}},{sessionId:'one'})[0];
    assert.equal(event?.event_type,type);
  }
});

test('registered Langflow writer alias uses the exact one-time approval gate', () => {
  const repo=new SigapRepository(':memory:');
  try{
    const session=repo.createSession();
    const batch=repo.createBatch({sessionId:session.session_id,requestId:'request',contextId:session.context_id,sourceSha256:'hash',sourceLength:1,filteredText:'x',piiSummary:{}});
    const id='1'.repeat(32),sha='a'.repeat(64);
    repo.saveSnapshot({snapshotId:id,snapshotSha256:sha,batchId:batch.batch_id,version:1,qualityStatus:'LOLOS_PEMERIKSAAN',payload:{records:[]}});
    assert.equal(verifyToolExecutionAgainstGate(repo,batch.batch_id,'sigap_0_fetch_shelters',{}).allow,true);
    assert.equal(verifyToolExecutionAgainstGate(repo,batch.batch_id,'sigap_5_upsert_shelter',{}).allow,false);
    const approval=validateAndCreateApproval(repo,repo.getBatch(batch.batch_id)!,'officer',{action:'approve_save',snapshot_id:id,partial_acknowledged:false,clear_decisions:{}}).approval!;
    const args={input_value:JSON.stringify(buildApprovedWritePayload(approval))};
    assert.equal(verifyToolExecutionAgainstGate(repo,batch.batch_id,'sigap_999_upsert_shelter',args).allow,false);
    assert.equal(verifyToolExecutionAgainstGate(repo,batch.batch_id,'sigap_5_upsert_shelter',args).allow,true);
    assert.equal(verifyToolExecutionAgainstGate(repo,batch.batch_id,'sigap_5_upsert_shelter',args).allow,false);
    assert.equal(verifyToolExecutionAgainstGate(repo,batch.batch_id,'sigap_6_draft_bulletin',{confirmed_create_doc:true}).allow,false);
  }finally{repo.close();}
});

test('numbered writer cannot bypass the unverified real ACP write guard', async () => {
  const repo=new SigapRepository(':memory:');
  try{
    const session=repo.createSession();
    const batch=repo.createBatch({sessionId:session.session_id,requestId:'request',contextId:session.context_id,sourceSha256:'hash',sourceLength:1,filteredText:'x',piiSummary:{}});
    const id='1'.repeat(32),sha='a'.repeat(64);
    repo.saveSnapshot({snapshotId:id,snapshotSha256:sha,batchId:batch.batch_id,version:1,qualityStatus:'LOLOS_PEMERIKSAAN',payload:{records:[]}});
    const approval=validateAndCreateApproval(repo,repo.getBatch(batch.batch_id)!,'officer',{action:'approve_save',snapshot_id:id,partial_acknowledged:false,clear_decisions:{}}).approval!;
    let permission:any;
    const runtime:AgentRuntime={isAvailable:async()=>true,initSession:async()=> 'acp',closeSession:async()=>{},sendPrompt:async(options,_onEvent,gate)=>{
      permission=await gate!(options.sessionId,{toolName:'sigap_5_upsert_shelter',toolCallId:'write',args:{input_value:JSON.stringify(buildApprovedWritePayload(approval))}});
    }};
    const orchestrator=new BatchOrchestrator(repo,runtime);
    await orchestrator.continueApprovedWrite(repo.getBatch(batch.batch_id)!,approval);
    assert.equal(permission.allow,false);
    assert.match(permission.reason,/belum diverifikasi/);
    assert.equal(repo.getPendingApprovalForSnapshot(batch.batch_id,id)?.approval_id,approval.approval_id);
    assert.notEqual(repo.getBatch(batch.batch_id)?.status,'done');
  }finally{repo.close();}
});
