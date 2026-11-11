// Read-only maintenance access, then local serialization/parser replay only.
import '../src/config.js';
import {loadConfig} from '../src/config.js';
import {SupabaseGateway} from '../src/supabase/client.js';
import {AuthService} from '../src/auth/service.js';
import {parseSigapReadResult} from '../src/pipeline/toolResults.js';
import {readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const [userId,authSessionId,contextId,python]=process.argv.slice(2);
const localReplay=process.argv.includes('--local-replay');
let revision:number;
if(!localReplay){
if(!/^[a-f0-9-]{36}$/i.test(userId||'')||!/^[a-f0-9-]{36}$/i.test(authSessionId||'')||!contextId||!python)throw Error('Existing active identity and Python required');
const settings=loadConfig().supabase;if(!settings)throw Error('Supabase required');
const gateway=new SupabaseGateway(settings),auth=new AuthService(gateway);
await auth.stillAuthorized(userId,authSessionId,contextId);
const stored=await gateway.call('storage.read',{actor_id:userId,context_id:contextId});
const replay=spawnSync(python,['scripts/measure-reader-format.py'],{cwd:'..',input:JSON.stringify(stored.document),encoding:'utf8',timeout:30000,maxBuffer:1024*1024});
if(replay.status!==0)throw Error('Offline formatter replay failed: '+replay.stderr);
revision=stored.revision;
}else{
 const value=process.argv.find(arg=>arg.startsWith('--storage-revision='))?.slice('--storage-revision='.length);
 if(!value||!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value)))throw Error('Observed storage revision required for local replay');
 revision=Number(value);
}
const formats=['human','compact'],payloads=formats.map(format=>readFileSync('../output/reader-format-replay/'+format+'.txt','utf8'));
assert.deepEqual(parseSigapReadResult(payloads[0]),parseSigapReadResult(payloads[1]));
assert.deepEqual(parseSigapReadResult(payloads[0]),parseSigapReadResult(payloads[1]+'\n'+payloads[1]));
const samples=[];
for(const index of [0,1,1,0]){
 const started=performance.now();for(let i=0;i<200;i++)parseSigapReadResult(payloads[index]+'\n'+payloads[index]);
 samples.push({format:formats[index],iterations:200,mean_ms:(performance.now()-started)/200});
}
const result={...JSON.parse(readFileSync('../ref/compact-reader-format.json','utf8')),backend_parsed_payloads_equal:true,storage_revision:revision,backend_parser_samples:samples};
writeFileSync('../ref/compact-reader-format.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
