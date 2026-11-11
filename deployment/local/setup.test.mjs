import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHmac} from 'node:crypto';

const script=resolve('deployment/local/setup.mjs');
const valid={SIGAP_WATSONX_URL:'https://us-south.ml.cloud.ibm.com',SIGAP_WATSONX_PROJECT_ID:'74ad8e39-cd09-4b7d-88bd-d18c9b2e47f1',SIGAP_WATSONX_API_KEY:'example_key_1234567890'};
function run(dir,overrides={}){
 return spawnSync(process.execPath,[script,'--from-environment'],{cwd:dir,env:{...process.env,...valid,...overrides},encoding:'utf8'});
}
test('setup creates isolated credentials once with valid local JWTs',()=>{
 const dir=mkdtempSync(join(tmpdir(),'sigap-local-setup-'));
 try{
  assert.equal(run(dir).status,0);
  const contents=readFileSync(join(dir,'.env.sigap-local'),'utf8');
  const env=Object.fromEntries(contents.trim().split('\n').map(line=>{const at=line.indexOf('=');return [line.slice(0,at),line.slice(at+2,-1)];}));
  for(const [name,role] of [['LOCAL_ANON_KEY','anon'],['LOCAL_SERVICE_ROLE_KEY','service_role']]){
   const [head,payload,signature]=env[name].split('.');
   assert.equal(JSON.parse(Buffer.from(payload,'base64url')).role,role);
   assert.equal(createHmac('sha256',env.LOCAL_JWT_SECRET).update(head+'.'+payload).digest('base64url'),signature);
  }
  assert.notEqual(env.LOCAL_ADMIN_PASSWORD,env.LOCAL_OFFICER_PASSWORD);
  assert.notEqual(env.LOCAL_OFFICER_PASSWORD,env.LOCAL_VIEWER_PASSWORD);
  assert.match(readFileSync(join(dir,'.sigap-local-accounts.txt'),'utf8'),/admin@sigap\.local/);
  assert.notEqual(run(dir).status,0);
  assert.equal(readFileSync(join(dir,'.env.sigap-local'),'utf8'),contents);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('setup rejects unsupported Watsonx URL without creating files',()=>{
 const dir=mkdtempSync(join(tmpdir(),'sigap-local-invalid-'));
 try{
  assert.notEqual(run(dir,{SIGAP_WATSONX_URL:'http://localhost:8000'}).status,0);
  assert.equal(existsSync(join(dir,'.env.sigap-local')),false);
  assert.equal(existsSync(join(dir,'.sigap-local-accounts.txt')),false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
