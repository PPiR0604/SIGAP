// Read-only signed gateway benchmark. Never prints identities or event content.
import {loadConfig} from '../src/config.js';
import {SupabaseGateway} from '../src/supabase/client.js';
async function main(){
 const sessionId=process.argv[2],settings=loadConfig().supabase;
 if(!settings||!sessionId)throw new Error('Configured session required');
 const gateway=new SupabaseGateway(settings),samples=[];
 let latest=0;
 for(const [mode,options] of [
  ['legacy_history',{}],['cursor',{latest_event_id:true}],
  ['reconnect',{after_event_id:()=>latest}],
 ] as const){
  const started=performance.now();
  const args:any={kind:'events',filter:{session_id:sessionId},...options};
  if(typeof args.after_event_id==='function')args.after_event_id=args.after_event_id();
  const data=await gateway.call<number|{event_id:number}[]>('entity.list',args);
  if(mode==='legacy_history'&&Array.isArray(data))latest=Math.max(0,...data.map(e=>e.event_id));
  samples.push({mode,duration_ms:Math.round(performance.now()-started),result_bytes:Buffer.byteLength(JSON.stringify(data)),rows:Array.isArray(data)?data.length:null,scalar_cursor:typeof data==='number'});
 }
 console.log(JSON.stringify({samples},null,2));
}
main().catch(()=>{console.error('Event history benchmark failed.');process.exitCode=1;});
