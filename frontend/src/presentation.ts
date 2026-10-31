import type {Shelter} from './demo';
import {reviewFieldLabel} from './reviewIndicators';
import {reviewForShelter,type PendingReview} from './pendingReviews';

export const qualityLabel=(s:Shelter)=>s.status==='Perlu klarifikasi'?'Perlu klarifikasi':s.status==='Parsial'?'Data belum lengkap':'Siap diperiksa';
export const stableShelterKey=(s:Shelter)=>s.shelterId||JSON.stringify(s.correctionTarget||{batch_id:s.sourceBatchId,report_id:s.id});
export function populationCoverage(rows:Shelter[]){const missing=rows.filter(s=>s.people===null).length;return `${rows.reduce((n,s)=>n+(s.people??0),0).toLocaleString('id-ID')} jiwa terdata${missing?` · ${missing} posko belum melaporkan jumlah jiwa`:''}`;}
export function tasksFor(rows:Shelter[],reviews:PendingReview[]){return rows.flatMap(s=>{
 const items=s.reviewItems||[],pending=reviewForShelter(reviews,s);
 const conflict=items.some(i=>i.kind==='clarification');
 if(!items.length&&!pending)return [];
 const priority=conflict?0:pending||items.some(i=>i.kind==='decision')?1:2;
 const difference=s.people!==null&&s.male!==null&&s.female!==null?s.male+s.female-s.people:0;
 return [{shelter:s,priority,pending,action:priority===0?'Periksa angka':priority===1?'Tinjau perubahan':'Lengkapi data',summary:difference?`Rincian berbeda ${Math.abs(difference)} jiwa.`:priority===0?'Ada data yang perlu diperiksa kembali.':priority===1?'Periksa usulan sebelum menyimpan.':`Lengkapi ${items.filter(i=>i.kind==='missing').slice(0,3).map(i=>reviewFieldLabel(i.field).toLocaleLowerCase('id-ID')).join(', ')||'stok dan waktunya'}.`,count:items.length}];
 }).sort((a,b)=>a.priority-b.priority||a.shelter.name.localeCompare(b.shelter.name,'id'));}
export const sourceFingerprint=(rows:Shelter[])=>JSON.stringify(rows.map(s=>[stableShelterKey(s),s.calculationKey,s.name,s.village]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));
