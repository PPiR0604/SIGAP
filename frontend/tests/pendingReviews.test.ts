import {test} from 'node:test';
import assert from 'node:assert/strict';
import {storedRows} from '../src/backendPreview.ts';
import {receiveReview,pendingRows,reviewForShelter,applyReviewCalculations,type PendingReview} from '../src/pendingReviews.ts';

const a={batch_id:'stored-a',report_id:'R002',shelter_name:'Posko Harapan',village:'A',total_people:98,male:43,female:55,elderly:12};
const b={batch_id:'stored-b',report_id:'R001',shelter_name:'Posko Cibening',village:'B',total_people:100,male:55,female:45,elderly:7};
const stored=storedRows([a,b]);
const candidate=(record:typeof a,batchId:string,elderly:number,superseded_snapshot_ids:string[]=[]):PendingReview=>({batchId,preview:{snapshot_id:`snapshot-${batchId}`,superseded_snapshot_ids,records:[{...record,report_id:'R001',batch_id:`source-${batchId}`,elderly,update_target:{batch_id:record.batch_id,report_id:record.report_id}}]}});

test('A then B then A retains both changes and replaces only the superseded signed snapshot',()=>{
  const first=candidate(a,'a1',16),second=candidate(b,'b1',8),third=candidate(a,'a2',17,['snapshot-a1']);
  const reviews=[first,second,third].reduce(receiveReview,[] as PendingReview[]);
  assert.deepEqual(reviews.map(r=>r.batchId),['b1','a2']);
  const rows=pendingRows(stored,reviews);
  assert.equal(rows.length,2);
  assert.deepEqual(rows.map(row=>row.elderly),[17,8]);
  assert.equal(reviewForShelter(reviews,rows[0])?.batchId,'a2');
  assert.equal(reviewForShelter(reviews,rows[1])?.batchId,'b1');
  assert.equal(first.preview.records![0].report_id,second.preview.records![0].report_id);
});

test('saving A retains B, including B calculations when stored recap calculations arrive',()=>{
  const pending=candidate(b,'b1',8),reviews=[pending];
  let rows=pendingRows(storedRows([{...a,elderly:17},b]),reviews);
  const result=(value:number,batch_id:string)=>({batch_id,shelters:[{shelter_name:b.shelter_name,village:b.village,needs:{air_liter_per_hari:{value}}}]});
  rows=applyReviewCalculations(rows,reviews,result(1500,'b1'));
  rows=applyReviewCalculations(rows,reviews,result(999,'a2'));
  rows=applyReviewCalculations(rows,reviews,{...result(777,'read-stored'),scope:'all_shelters',pending_candidates:false,snapshot_refs:[{kind:'stored',snapshot_id:'saved'}]});
  assert.equal(rows[1].elderly,8);
  assert.equal(rows[1].water,1500);
  assert.equal(reviewForShelter(reviews,rows[0]),undefined);
  assert.equal(reviewForShelter(reviews,rows[1])?.batchId,'b1');
  rows=applyReviewCalculations(rows,reviews,{...result(1501,'all'),scope:'all_shelters',snapshot_refs:[{kind:'candidate',snapshot_id:pending.preview.snapshot_id}]});
  assert.equal(rows[1].water,1501);
});

test('explicit supersession preserves a village rename without creating duplicate rows',()=>{
  const first=candidate(a,'a1',16);
  const next=candidate(a,'a2',17,['snapshot-a1']);
  next.preview.records![0].village='Desa baru';
  const reviews=receiveReview([first,candidate(b,'b1',8)],next);
  const rows=pendingRows(stored,reviews);
  assert.deepEqual(rows.map(row=>row.village),['Desa baru','B']);
  assert.equal(rows[1].elderly,8);
});
