import type {BatchRecord,SnapshotRecord} from './repo.js';

export interface WorkspaceState {
  reviews:Array<{snapshot:SnapshotRecord;batch:BatchRecord}>;
  activeBatch:BatchRecord|null;
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
