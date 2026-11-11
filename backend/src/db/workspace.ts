import type {BatchRecord,SnapshotRecord} from './repo.js';

export interface WorkspaceState {
  reviews:Array<{snapshot:SnapshotRecord;batch:BatchRecord}>;
  activeBatch:BatchRecord|null;
}

export interface SubmissionState {
  existingBatch:BatchRecord|null;
  activeBatchId:string|null;
  firstTurn:boolean;
}

/** Validate only the requested session's bounded dispatcher response. */
export function checkedWorkspaceState(value:unknown,sessionId:string,activeOnly=false):WorkspaceState {
  const state=value as WorkspaceState;
  const active=state?.activeBatch;
  if(!state||!Array.isArray(state.reviews)||
    !(active===null||active&&active.session_id===sessionId&&typeof active.batch_id==='string'&&active.batch_id.length>0&&['processing','saving','verifying'].includes(active.status))||
    activeOnly&&state.reviews.length>0||
    !state.reviews.every(row=>row?.batch?.session_id===sessionId&&row.batch.status==='ready_for_review'&&typeof row.batch.batch_id==='string'&&row.batch.batch_id.length>0&&
      row.snapshot?.batch_id===row.batch.batch_id&&typeof row.snapshot.snapshot_id==='string'&&typeof row.snapshot.snapshot_sha256==='string'&&
      typeof row.snapshot.payload_json==='string'&&typeof row.snapshot.expires_at==='string'&&row.snapshot.superseded_by===null)||
    new Set(state.reviews.map(row=>row.snapshot.snapshot_id)).size!==state.reviews.length)
      throw new Error('Invalid workspace state');
  return state;
}

/** Bounded parallel reads; preserve source order and settle in-flight work on failure. */
export async function mapConcurrent<T,R>(items:T[],limit:number,read:(item:T)=>Promise<R>):Promise<R[]> {
  const results:R[]=new Array(items.length);
  let next=0,failed=false;
  const workers=Array.from({length:Math.min(limit,items.length)},async()=>{
    while(!failed){
      const index=next++;
      if(index>=items.length)return;
      try{results[index]=await read(items[index]);}catch(error){failed=true;throw error;}
    }
  });
  const settled=await Promise.allSettled(workers);
  for(const result of settled)if(result.status==='rejected')throw result.reason;
  return results;
}
