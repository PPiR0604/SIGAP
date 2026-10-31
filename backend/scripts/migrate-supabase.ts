/** Reviewable, idempotent import. Source SQLite files are read-only. No automatic user ownership. */
import '../src/config.js';
import {loadConfig} from '../src/config.js';
import {SupabaseGateway} from '../src/supabase/client.js';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,existsSync,mkdirSync,readdirSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
const option=(name:string)=>process.argv.find(a=>a.startsWith('--'+name+'='))?.split('=').slice(1).join('=');
const metadata=option('metadata'),shelters=option('shelters'),organization=option('organization'),context=option('context')||'posko-default';
if(!metadata||!shelters||!organization||!/^[-a-zA-Z0-9_]{1,80}$/.test(context))throw new Error('Required: --metadata=BACKUP.db --shelters=BACKUP.sqlite3 --organization=UUID [--context=posko-default] [--snapshots=DIR] [--apply]');
const entities:any[]=[];const counts:Record<string,number>={};
function source(file:string){if(!existsSync(file))throw new Error('Missing source backup');const db=new DatabaseSync(resolve(file),{readOnly:true});if(db.prepare('pragma integrity_check').all().some(r=>Object.values(r)[0]!=='ok'))throw new Error('Invalid backup');return db;}
const meta=source(metadata);
try{for(const kind of ['sessions','batches','events','snapshots','approvals','audit_log']){
 const rows=meta.prepare('select * from '+kind).all() as any[];counts[kind]=rows.length;
 for(const row of rows){
  const key=String(row.session_id&&kind==='sessions'?row.session_id:row.batch_id&&kind==='batches'?row.batch_id:row.snapshot_id&&kind==='snapshots'?row.snapshot_id:row.approval_id&&kind==='approvals'?row.approval_id:kind==='events'?row.event_id:row.id);
  // Historical approvals are retained for audit but can never authorize a new write.
  if(kind==='approvals'&&row.status==='pending'){row.legacy_status='pending';row.status='revoked';}
  if(kind==='batches'&&['processing','saving','verifying'].includes(row.status)){row.legacy_status=row.status;row.status='needs_review';}
  if(kind==='sessions'){row.owner_user_id=null;row.organization_id=organization;row.context_id=context;row.legacy_context_id=meta.prepare('select context_id from sessions where session_id=?').get(row.session_id)!.context_id;}
  if(kind==='audit_log')row.organization_id=organization;
  entities.push({kind,id:key,document:{...row,legacy_import:true}});
 }
}}finally{meta.close();}
const store=source(shelters);let storage:any;
try{
 const header=JSON.parse(String(store.prepare("select value from storage_meta where key='header'").get()?.value||'[]'));
 const rows=store.prepare('select row_json from shelters order by rowid').all().map(r=>JSON.parse(String(r.row_json)));storage={header,rows};counts.shelters=rows.length;
 for(const kind of ['shelter_history','storage_commits','storage_meta']){const rows=store.prepare('select * from '+kind).all() as any[];counts[kind]=rows.length;for(let i=0;i<rows.length;i++)entities.push({kind:'legacy_'+kind,id:String(rows[i].id??rows[i].commit_key??rows[i].key??i),document:rows[i]});}
}finally{store.close();}
const snapshotDir=option('snapshots');if(snapshotDir){for(const file of readdirSync(snapshotDir).filter(f=>f.endsWith('.json')))entities.push({kind:'legacy_flow_snapshots',id:file,document:JSON.parse(readFileSync(join(snapshotDir,file),'utf8'))});}
const payload={organization_id:organization,context_id:context,entities,storage};
const digest=createHash('sha256').update(JSON.stringify(payload)).digest('hex');
const output=resolve(option('output')||'../output/auth-migration/import-manifest.json');mkdirSync(dirname(output),{recursive:true});
writeFileSync(output,JSON.stringify({...payload,manifest_hash:digest,counts},null,2));
if(process.argv.includes('--apply')){const config=loadConfig();if(!config.supabase||config.supabase.organizationId!==organization)throw new Error('Target organization differs from reviewed manifest.');const gateway=new SupabaseGateway(config.supabase);const receipt=await gateway.call('migration.import',{...payload,manifest_hash:digest});if(receipt.entity_count!==entities.length||receipt.shelter_count!==storage.rows.length)throw new Error('Import count mismatch');
 // Read back complete payloads, not just counts. Event identifiers remain historical.
 const verification=await gateway.call('migration.verify',payload);if(verification.mismatch_count!==0||verification.entity_count!==entities.length||verification.storage_matches!==true)throw new Error('Imported entity/field verification failed.');
 writeFileSync(output+'.receipt.json',JSON.stringify(receipt,null,2));
}
console.log(JSON.stringify({applied:process.argv.includes('--apply'),manifest:digest,counts,source_preserved:true,output}));
