import type {Shelter} from './demo';
import {matchesClarificationTarget,mergeCandidateOntoStored,previewRows,retainUnchangedCalculations,type Preview} from './backendPreview';
import {applyCalculations} from './needs';

/** Each signed snapshot retains its own batch and approval decisions, even when report IDs repeat. */
export type PendingReview={batchId:string;preview:Preview};
function olderReport(candidate:Shelter,current:Shelter):boolean{
  if(candidate.shelterId&&current.shelterId&&candidate.shelterId!==current.shelterId)return false;
  if(!matchesClarificationTarget(candidate,current))return false;
  const stamp=(value?:string|null)=>value?.replace('T',' ').slice(0,16);
  const before=stamp(candidate.reportedAt),after=stamp(current.reportedAt);
  return !!before&&!!after&&before<after;
}
export function olderReview(review:PendingReview,stored:Shelter[]):boolean{
  const rows=previewRows(review.preview);
  return rows.length>0&&rows.every(row=>stored.some(current=>olderReport(row,current)));
}
export function receiveReview(previous:PendingReview[],review:PendingReview):PendingReview[]{
  const superseded=new Set(review.preview.superseded_snapshot_ids||[]);
  return [...previous.filter(old=>old.batchId!==review.batchId&&!superseded.has(old.preview.snapshot_id||'')),review];
}
export function pendingRows(stored:Shelter[],reviews:PendingReview[],previous:Shelter[]=[]):Shelter[]{
  const rows=reviews.reduce((base,review)=>mergeCandidateOntoStored(base,previewRows(review.preview).filter(row=>!base.some(current=>olderReport(row,current)))),stored);
  return retainUnchangedCalculations(previous,rows);
}
export function reviewForShelter(reviews:PendingReview[],shelter:Shelter):PendingReview|undefined{
  return [...reviews].reverse().find(review=>previewRows(review.preview).some(row=>matchesClarificationTarget(row,shelter)&&!olderReport(row,shelter)));
}
export function reviewLabel(review:PendingReview):string{
  return previewRows(review.preview).map(row=>`${row.name} · ${row.village}`).join('; ');
}
export function applyReviewCalculations(rows:Shelter[],reviews:PendingReview[],data:any):Shelter[]{
  return rows.map(row=>{
    const owner=reviewForShelter(reviews,row);
    // A saved recap excludes other uncommitted corrections. Its calculations cannot replace theirs.
    const includesOwner=data.scope==='all_shelters'&&data.snapshot_refs?.some((ref:any)=>ref.kind==='candidate'&&ref.snapshot_id===owner?.preview.snapshot_id);
    if(owner&&data.batch_id&&owner.batchId!==data.batch_id&&!includesOwner)return row;
    return applyCalculations([row],data)[0];
  });
}
