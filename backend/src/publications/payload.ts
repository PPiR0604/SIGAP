import {createHash} from 'node:crypto';
import {filterPii} from '../pipeline/pii.js';

const counts=['total_people','total_families','male','female','infants_toddlers','children','elderly','pregnant','breastfeeding','disability'] as const;
const metrics=['air_liter_per_hari','kkal_per_hari','jamban_unit','ruang_hunian_m2'] as const;
const quantity=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
const text=(v:unknown,max=300)=>typeof v==='string'?filterPii(v.slice(0,max)).filteredText:'';
const date=(v:unknown)=>typeof v==='string'&&Number.isFinite(Date.parse(v))?v:null;
const reportedNeed=(n:any)=>{
 if(typeof n==='string'){
  // Only explicit, unambiguous quantities with a recognized unit; do not infer from prose.
  const match=/^\s*(.+?)\s*\((\d+(?:[.,]\d{1,2})?)\s*(kg|liter|l|dus|karton|sak|karung|unit|buah|paket|lembar)\)\s*$/i.exec(n);
  if(match){const item=text(match[1]).trim(),qty=Number(match[2].replace(',','.')),unit=text(match[3],40).trim();if(item&&Number.isFinite(qty))return {item,qty,unit};}
 }
 const item=text(typeof n==='string'?n:n?.item||n?.name||n?.category);
 if(!item)return null;
 const qty=quantity(n?.qty),unit=text(n?.unit,40).trim();
 return qty!==null&&unit?{item,qty,unit}:item;
};
const canonical=(value:any):any=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
// JSONB does not retain object key order; arrays retain their meaningful source order.
export const digest=(value:unknown)=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(canonical(value))).digest('hex');
export const draftFingerprint=(batch:{bulletin_payload_json:string|null})=>digest(batch.bulletin_payload_json||'');

/** Reconstruct only the exact legacy public schema to verify pre-fix approvals without rewriting them. */
export function legacyPublicDigest(payload:any):string|null {
 const ordered=(value:any,keys:string[])=>{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))throw new Error('Legacy schema mismatch');
  return Object.fromEntries(keys.map(key=>[key,value[key]]));
 };
 try{
  const data=ordered(payload,['schema_version','content','context_name','generated_at','source','calculation_available','records']);
  if(data.schema_version!=='sigap-public-bulletin-v1'||!Array.isArray(data.records))return null;
  data.source=ordered(data.source,['version','kind']);
  data.records=data.records.map((record:any)=>{
   const row=ordered(record,['report_id','shelter_name','village',...counts,'is_estimate','reported_at','urgent_needs','quality','requirements','shortages',...(Object.hasOwn(record,'planning')?['planning']:[])]);
   row.requirements=ordered(row.requirements,[...metrics]);row.shortages=ordered(row.shortages,[...metrics]);
   if(row.planning){
    row.planning=ordered(row.planning,['schema_version','complete_age_counts','nutrition','age_groups','issues']);
    row.planning.nutrition=ordered(row.planning.nutrition,['energy_kcal','protein_g','fat_g','carbohydrate_equivalent_g']);
    row.planning.age_groups=row.planning.age_groups.map((group:any)=>ordered(group,['key','people','water_l','energy_kcal']));
   }
   return row;
  });
  return createHash('sha256').update(JSON.stringify(data)).digest('hex');
 }catch{return null;}
}

export function publicPayloadVerified(document:any):boolean {
 if(!document?.payload||typeof document.review_sha256!=='string')return false;
 if(document.digest_scheme==='canonical-json-v1')return digest(document.payload)===document.review_sha256;
 return document.digest_scheme==null&&legacyPublicDigest(document.payload)===document.review_sha256;
}

/** Explicit public projection: never publish original reports, provenance, contacts or server identities. */
export function publicBulletinPayload(draft:any,calculation:any){
 const source=draft.source_metadata||{};
 const records=Array.isArray(source.records)?source.records:Array.isArray(draft.records)?draft.records:[];
 const norm=(v:unknown)=>String(v??'').trim().toLowerCase().replace(/\s+/g,' ');
 const rows=records.map((record:any,index:number)=>{
  const matches=(calculation?.shelters||[]).filter((s:any)=>norm(s.shelter_name)===norm(record.shelter_name)&&norm(s.village)===norm(record.village));
  const result=matches.length===1?matches[0]:null;
  const conflict=(record.validation_issues||[]).some((i:any)=>typeof i==='string'||i.field!=='storage_conflicts')||record.pending_clear_fields?.length||record.stock_issues?.length||record.storage_issues?.length||record.unverified_numbers?.length||(record.total_people!=null&&record.male!=null&&record.female!=null&&record.male+record.female!==record.total_people);
  const missing=record.missing_fields?.length||record.total_people==null;
  const planning=result?.planning;
  return {
   report_id:`P${index+1}`,shelter_name:text(record.shelter_name)||'Nama belum diketahui',village:text(record.village)||null,
   ...Object.fromEntries(counts.map(key=>[key,quantity(record[key])])),
   is_estimate:record.is_estimate===true,reported_at:date(record.reported_at),
   urgent_needs:(Array.isArray(record.urgent_needs)?record.urgent_needs:[]).map(reportedNeed).filter(Boolean),
   quality:conflict?'Perlu klarifikasi':missing?'Parsial':'Siap ditinjau',
   requirements:Object.fromEntries(metrics.map(key=>[key,quantity(result?.needs?.[key]?.value)])),
   shortages:Object.fromEntries(metrics.map(key=>[key,quantity(result?.gaps?.[key])])),
   ...(planning?.schema_version==='sphere2018-population-v1'?{planning:{schema_version:planning.schema_version,complete_age_counts:planning.complete_age_counts===true,
    nutrition:Object.fromEntries(['energy_kcal','protein_g','fat_g','carbohydrate_equivalent_g'].map(key=>[key,quantity(planning.nutrition?.[key])])),
    age_groups:planning.age_groups.map((g:any)=>({key:g.key,people:quantity(g.people),water_l:quantity(g.water_l),energy_kcal:quantity(g.energy_kcal)})),issues:[]}}:{})
  };
 });
 return {schema_version:'sigap-public-bulletin-v1',content:text(draft.content,300000),context_name:text(source.context_name)||'Operasi SIGAP',generated_at:date(source.generated_at||draft.preview_at),
  source:{version:typeof source.snapshot_sha256==='string'?source.snapshot_sha256.slice(0,12):typeof draft.snapshot_sha256==='string'?draft.snapshot_sha256.slice(0,12):null,kind:source.kind==='stored'?'stored':source.kind==='snapshot'?'candidate':'unknown'},
  calculation_available:!!calculation,records:rows};
}

export type PublicBulletinPayload=ReturnType<typeof publicBulletinPayload>;
