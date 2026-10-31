import {createHash,randomBytes} from 'node:crypto';
import type {SupabaseGateway} from '../supabase/client.js';
const stable=(v:any):any=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
export const snapshotHash=(payload:unknown)=>createHash('sha256').update(JSON.stringify(stable(payload))).digest('hex');
/** Split only an authentic immutable server snapshot, never a browser/model supplied record. */
export async function splitRowSnapshots(gateway:SupabaseGateway,actorId:string,contextId:string,reference:{snapshot_id:string;snapshot_sha256:string}){
 const args={actor_id:actorId,context_id:contextId};
 const loaded=await gateway.call('flow.load',{...args,id:reference.snapshot_id});
 const envelope=loaded?.envelope;
 if(!envelope||loaded.committed_reference||envelope.sha256!==reference.snapshot_sha256)throw new Error('Snapshot tidak dapat dipisahkan dengan aman. Validasi ulang laporan.');
 const payload=envelope.payload;
 if(!Array.isArray(payload.records)||payload.records.length<2)return [];
 if(Array.isArray(payload.row_snapshot_refs)){
  if(payload.row_snapshot_refs.length!==payload.records.length)throw new Error('Referensi draf tidak lengkap.');
  const parts=[];
  for(const [index,ref] of payload.row_snapshot_refs.entries()){
   const child=await gateway.call('flow.load',{...args,id:ref.snapshot_id});
   const value=child?.envelope;
   if(!value||child.committed_reference||value.sha256!==ref.snapshot_sha256||value.payload.records?.length!==1||JSON.stringify(stable(value.payload.records[0]))!==JSON.stringify(stable(payload.records[index])))throw new Error('Draf tidak sesuai kandidat sumber.');
   parts.push({...ref,records:value.payload.records,snapshot_records:value.payload.records,issues:value.payload.issues||[],snapshot_issues:value.payload.snapshot_issues||[]});
  }
  return parts;
 }
 // Compatibility for pre-upgrade snapshots; fail closed if numeric canonicalization differs.
 if(snapshotHash(payload)!==reference.snapshot_sha256)throw new Error('Snapshot lama perlu divalidasi ulang.');
 const result=[];
 for(const record of payload.records){
  const issues=(payload.issues||[]).filter((issue:any)=>!issue.report_id||issue.report_id===record.report_id);
  const child={...payload,records:[record],report_records:(payload.report_records||[]).filter((r:any)=>r.report_id===record.report_id),issues,snapshot_issues:(payload.snapshot_issues||[]).filter((i:any)=>!i.report_id||i.report_id===record.report_id)};
  const id=randomBytes(16).toString('hex'),hash=snapshotHash(child);
  await gateway.call('flow.save',{...args,id,envelope:{created_at:envelope.created_at,sha256:hash,payload:child}});
  result.push({snapshot_id:id,snapshot_sha256:hash,records:child.records,issues, snapshot_records:child.records,snapshot_issues:child.snapshot_issues});
 }
 return result;
}
