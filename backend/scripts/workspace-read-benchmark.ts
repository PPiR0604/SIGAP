// Read-only: no model calls, writes, tokens, identities or report content in output.
import {loadConfig} from '../src/config.js';
import {SupabaseGateway} from '../src/supabase/client.js';
import {SupabaseRepository} from '../src/db/supabase.js';
async function main(){
 const settings=loadConfig().supabase;if(!settings)throw new Error('Supabase belum dikonfigurasi.');
 const gateway=new SupabaseGateway(settings);
 const sessions=await gateway.call<any[]>('entity.list',{kind:'sessions',filter:{status:'active'}});
 const session=sessions.sort((a,b)=>b.last_active_at.localeCompare(a.last_active_at))[0];
 if(!session){console.log(JSON.stringify({status:'no_active_session'}));return;}
 const original=gateway.call.bind(gateway);let requests=0;
 gateway.call=async<T>(action:string,args:Record<string,unknown>={})=>{requests++;return original<T>(action,args);};
 const repo=new SupabaseRepository(gateway),started=performance.now();
 const state=await repo.getWorkspaceState(session.session_id);
 console.log(JSON.stringify({stage:'workspace_state',duration_ms:Math.round(performance.now()-started),requests,reviews:state.reviews.length,active_batch:!!state.activeBatch}));
}
main().catch(()=>{console.error('Pengukuran pembacaan ruang kerja gagal.');process.exitCode=1;});
