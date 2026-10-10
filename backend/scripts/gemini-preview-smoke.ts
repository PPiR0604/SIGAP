// Real Gemini + local MCP preview only. No writer, storage verification or publication.
import {loadGeminiSettings} from '../src/gemini/config.js';
import {GeminiAgentRuntime} from '../src/gemini/runtime.js';
import {loadAgentSessionConfig} from '../src/acp/sessionConfig.js';
import {canonicalToolName} from '../src/acp/toolNames.js';
import {parsePrepareNeedsOutput} from '../src/pipeline/toolResults.js';
import {wrapUntrustedInputForAgent} from '../src/pipeline/pii.js';
async function main(){
  const runtime=new GeminiAgentRuntime(loadGeminiSettings());
  if(!await runtime.isAvailable())throw new Error('Isi key Gemini di backend/data/gemini.local.json terlebih dahulu.');
  const config=loadAgentSessionConfig('gemini');const sessionId='gemini-preview-smoke';
  const report='2026-10-08 10:00 | Posko Uji Sintetis, Desa Uji. Total 10 jiwa: 4 laki-laki dan 6 perempuan. Butuh air bersih.';
  let preview:any;
  try{
    await runtime.initSession({...config,sessionId,contextId:'synthetic-preview',systemPrompt:config.systemPrompt+'\nUJI: hanya prepare dan validate untuk laporan sintetis; berhenti setelah snapshot validator tersedia. Tidak ada write, fetch rekap, kalkulasi atau buletin.'});
    await runtime.sendPrompt({sessionId,batchId:'smoke',requestId:'smoke',operation:'prepare',filteredText:report,prompt:wrapUntrustedInputForAgent(report,'synthetic-preview')},event=>{
      if(event.event_type==='preview_ready')preview=parsePrepareNeedsOutput(event.payload.rawOutput);
    },async(_sid,call)=>({allow:['prepare_needs','validate_needs'].includes(canonicalToolName(call.toolName)||'')}));
    if(!preview?.records?.length&&!preview?.snapshot_records?.length)throw new Error('Gemini belum menghasilkan snapshot validator yang dapat diverifikasi.');
    console.log(JSON.stringify({status:'preview_verified',model:loadGeminiSettings().model,snapshot_id:preview.snapshot_id,snapshot_sha256:preview.snapshot_sha256,record_count:preview.records.length,external_write:false},null,2));
  }finally{await runtime.shutdown();}
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Smoke Gemini gagal.');process.exitCode=1;});
