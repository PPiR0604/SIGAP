// Read-only measurement: no login, token creation, operational writes, or permission cache.
import {loadConfig} from '../src/config.js';
import {SupabaseGateway} from '../src/supabase/client.js';
import {AuthService} from '../src/auth/service.js';

const [userId,sessionId,contextId]=process.argv.slice(2);
if(!userId||!sessionId||!contextId)throw new Error('Usage: tsx scripts/measure-authorization-latency.ts USER_ID AUTH_SESSION_ID CONTEXT_ID');
const settings=loadConfig().supabase;
if(!settings)throw new Error('Supabase is not configured.');
const gateway=new SupabaseGateway(settings),auth=new AuthService(gateway);
const serial=async()=>{
  if(!await gateway.call('session.valid',{session_id:sessionId,user_id:userId}))throw new Error('Session revoked.');
  await gateway.call('scope.check',{actor_id:userId,context_id:contextId});
};
const parallel=()=>auth.stillAuthorized(userId,sessionId,contextId);
await serial();await parallel(); // Warm both paths before alternating the samples.
const samples:{serial_ms:number[];parallel_ms:number[]}={serial_ms:[],parallel_ms:[]};
for(let index=0;index<5;index++){
  const order=index%2?[['parallel_ms',parallel],['serial_ms',serial]] as const:[['serial_ms',serial],['parallel_ms',parallel]] as const;
  for(const [key,run] of order){const started=performance.now();await run();samples[key].push(Math.round(performance.now()-started));}
}
const median=(values:number[])=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
const before=median(samples.serial_ms),after=median(samples.parallel_ms);
console.log(JSON.stringify({read_only:true,samples,median_serial_ms:before,median_parallel_ms:after,reduction_percent:Math.round((before-after)/before*100)},null,2));
