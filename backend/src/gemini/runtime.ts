import {randomUUID} from 'node:crypto';
import type {AgentRuntime,AgentSessionConfig,AgentPromptOptions,AgentEventHandler,PermissionGate} from '../acp/types.js';
import {canonicalToolName} from '../acp/toolNames.js';
import {createEvent,normalizeAcpNotification} from '../acp/events.js';
import {McpHttpClient,type McpTool} from '../mcp/httpClient.js';
import {GeminiApiClient,type GeminiModelClient,type GeminiTurn,type GeminiUsage} from './client.js';
import type {GeminiSettings} from './config.js';
import {compactToolResult,pruneHistory,shrinkConsumedPrepare} from './context.js';
import {TokenRateLimiter} from './rateLimit.js';
import {logger} from '../logging.js';
import {ToolValidationError} from '../acp/errors.js';
import {GeminiUnavailableError} from './errors.js';
import {ModelProviderError} from '../openai/errors.js';

export interface GeminiRuntimeLimits {maxRounds:number;maxToolCalls:number;maxHistoryBytes:number;operationTimeoutMs:number;contextBudgetBytes:number}
// contextBudgetBytes: target riwayat lintas operasi (~25 ribu token); maxHistoryBytes tetap batas keras per operasi.
const defaults:GeminiRuntimeLimits={maxRounds:12,maxToolCalls:24,maxHistoryBytes:1048576,operationTimeoutMs:300000,contextBudgetBytes:65536};
const KEEP_FULL_OPERATIONS=1,MAX_OLD_STRING_CHARS=1500;
interface Session {mcp:McpHttpClient;tools:McpTool[];history:GeminiTurn[];instruction:string;lifetime:AbortController}

async function cancellable<T>(promise:Promise<T>,signal:AbortSignal):Promise<T>{
  if(signal.aborted)throw new Error('Operasi Gemini dibatalkan atau timeout.');
  return new Promise<T>((resolve,reject)=>{
    const abort=()=>{signal.removeEventListener('abort',abort);reject(new Error('Operasi Gemini dibatalkan atau timeout.'));};
    signal.addEventListener('abort',abort,{once:true});
    promise.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
  });
}

export class GeminiAgentRuntime implements AgentRuntime {
  readonly provider:'gemini'|'openai'='gemini';
  get model():string{return this.settings.model;}
  private sessions=new Map<string,Promise<Session>>();
  private resources=new Map<string,Session>();
  private busy=new Set<string>();
  private client:GeminiModelClient|null;
  private stopped=false;
  private limits:GeminiRuntimeLimits;
  private limiter:TokenRateLimiter;
  constructor(private settings:GeminiSettings,client?:GeminiModelClient,limits:Partial<GeminiRuntimeLimits>={}){
    this.client=client??(settings.apiKey?new GeminiApiClient(settings):null);
    this.limiter=new TokenRateLimiter(settings.tpmLimit??0);
    this.limits={...defaults};
    for(const key of Object.keys(defaults) as Array<keyof GeminiRuntimeLimits>){
      const value=limits[key]??defaults[key];if(!Number.isInteger(value)||value<1)throw new Error('Batas runtime Gemini tidak valid.');
      this.limits[key]=Math.min(value,defaults[key]);
    }
  }
  private configured():boolean{return !!this.settings.apiKey&&!!this.client&&!/^YOUR_|^GANTI_DENGAN_/.test(this.settings.apiKey)&&!this.stopped;}
  async isAvailable():Promise<boolean>{return this.configured();}
  async initSession(config:AgentSessionConfig):Promise<string>{
    if(this.stopped)throw new Error('Runtime Gemini sudah ditutup.');
    let pending=this.sessions.get(config.sessionId);
    if(!pending){pending=this.createSession(config);this.sessions.set(config.sessionId,pending);}
    try{await pending;return config.sessionId;}
    catch(err){
      await this.closeSession(config.sessionId);
      const reason = err instanceof Error ? err.message : String(err);
      logger.error('Gagal inisialisasi sesi Gemini/MCP:', { error: reason });
      throw new Error(`Gemini atau MCP belum dikonfigurasi/dapat dihubungi (${reason}).`);
    }
  }
  /** Baca rekap tersimpan langsung lewat MCP tanpa melibatkan model (nol token Gemini). */
  async readStoredRekap(sessionId:string,signal?:AbortSignal){
    const pending=this.sessions.get(sessionId);if(!pending)return null;
    const session=await pending;
    const tool=session.tools.find(t=>canonicalToolName(t.name)==='fetch_shelters');if(!tool)return null;
    const properties=((tool.inputSchema as any)?.properties??{}) as Record<string,unknown>;
    const args:Record<string,unknown>='input_value' in properties?{input_value:JSON.stringify({action:'all'})}:{};
    const combined=AbortSignal.any([session.lifetime.signal,AbortSignal.timeout(this.limits.operationTimeoutMs),...(signal?[signal]:[])]);
    const result=await session.mcp.callTool(tool.name,args,combined);
    return result.isError?null:result;
  }
  private async createSession(config:AgentSessionConfig):Promise<Session>{
    if(!this.configured())throw new Error('Key Gemini belum dikonfigurasi.');
    const server=config.mcpServerConfig?.find((s:any)=>s.name==='langflow'&&s.type==='http');
    if(!server)throw new Error('Konfigurasi MCP HTTP Langflow diperlukan.');
    const mcp=new McpHttpClient({url:server.url,headers:Object.fromEntries((server.headers||[]).map((h:any)=>[h.name,h.value]))});
    const session:Session={mcp,tools:[],history:[],instruction:config.systemPrompt||'Anda adalah SIGAP. Gunakan tool Langflow; jangan mengarang data atau melakukan write tanpa persetujuan backend.',lifetime:new AbortController()};
    this.resources.set(config.sessionId,session);
    await mcp.initialize(session.lifetime.signal);
    session.tools=(await mcp.listTools(session.lifetime.signal)).filter(tool=>canonicalToolName(tool.name));
    if(!session.tools.length)throw new Error('Tool SIGAP tidak tersedia.');
    return session;
  }
  /** Read-only calculation for a verified snapshot, including automatic correction recalculation. */
  async calculateNeedsForSnapshot(sessionId:string,reference:{snapshot_id:string;snapshot_sha256:string}){
    const session=await this.sessions.get(sessionId);
    if(!session)throw new Error('Sesi Gemini belum diinisialisasi.');
    const tool=session.tools.find(tool=>canonicalToolName(tool.name)==='calculate_gap');
    if(!tool)throw new Error('Tool kalkulasi Langflow tidak tersedia.');
    return session.mcp.callTool(tool.name,{input_value:JSON.stringify(reference)},session.lifetime.signal);
  }
  async sendPrompt(options:AgentPromptOptions,onEvent:AgentEventHandler,gate?:PermissionGate):Promise<void>{
    if(!gate)throw new Error('Runtime Gemini memerlukan gerbang izin backend.');
    if(this.busy.has(options.sessionId))throw new Error('Sesi Gemini sedang memproses operasi lain.');
    this.busy.add(options.sessionId);
    try{
      const pending=this.sessions.get(options.sessionId);if(!pending)throw new Error('Sesi Gemini belum diinisialisasi.');
      const session=await pending;
      const signal=AbortSignal.any([session.lifetime.signal,AbortSignal.timeout(this.limits.operationTimeoutMs)]);
      const meta={sessionId:options.sessionId,batchId:options.batchId,requestId:options.requestId};
      const prior=pruneHistory(session.history,{keepFullOperations:KEEP_FULL_OPERATIONS,maxOldStringChars:MAX_OLD_STRING_CHARS,budgetBytes:this.limits.contextBudgetBytes});
      const history=[...prior,{role:'user' as const,parts:[{text:options.prompt}]}];
      const bounded=()=>{if(Buffer.byteLength(JSON.stringify(history),'utf8')>this.limits.maxHistoryBytes)throw new Error('Riwayat Gemini melebihi batas. Buat sesi baru.');};
      const offered=session.tools.filter(t=>options.operation==='commit'?!['prepare_needs','validate_needs'].includes(canonicalToolName(t.name)!):canonicalToolName(t.name)!=='upsert_shelter');
      let toolCalls=0,writeDispatched=false;
      const staticBytes=Buffer.byteLength(JSON.stringify(offered)+session.instruction,'utf8');
      const operationStart=prior.length;
      let sourceReference:{batch_id:string;source_sha256:string}|null=null;
      let validated=false;
      let validationFailure:string|undefined;
      let validationFailures=0;
      onEvent(createEvent(options.sessionId,'processing_started',{},meta));
      const total={requests:0,promptTokens:0,outputTokens:0,totalTokens:0};
      try{
      for(let round=0;round<this.limits.maxRounds;round++){
        bounded();signal.throwIfAborted();
        const requestBytes=Buffer.byteLength(JSON.stringify(history),'utf8');
        const onUsage=(usage:GeminiUsage)=>{
          this.limiter.record(usage.promptTokens);
          total.requests++;total.promptTokens+=usage.promptTokens;total.outputTokens+=usage.outputTokens;total.totalTokens+=usage.totalTokens;
          logger.info('LLM usage',{provider:this.provider,operation:options.operation,round:round+1,history_bytes:requestBytes,static_bytes:staticBytes,...usage});
        };
        await this.limiter.acquire(Math.ceil((requestBytes+staticBytes)/3),signal,()=>onEvent(createEvent(options.sessionId,'stage_changed',{stage:'waiting_quota'},meta)));
        const turn=await cancellable(this.client!.generate(history,offered,session.instruction,signal,onUsage),signal);
        if(turn.role!=='model'||!Array.isArray(turn.parts)||!turn.parts.length)throw new Error('Respons Gemini kosong atau tidak valid.');
        history.push(turn);bounded();
        const calls=turn.parts.filter(part=>part.functionCall).map(part=>part.functionCall as any);
        let recoveredExtraction=false;
        // Some providers return prepare's requested extraction JSON instead of a tool call.
        // Only bridge that exact shape to the read-only validator with this operation's source.
        const validator=offered.find(tool=>canonicalToolName(tool.name)==='validate_needs');
        if(!calls.length&&!validated&&sourceReference&&validator&&options.operation==='prepare'){
          const text=turn.parts.filter(part=>typeof part.text==='string'&&!part.thought).map(part=>part.text).join('\n').trim();
          const fenced=/^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(text);
          let extraction:any;
          try{extraction=JSON.parse(fenced?.[1]??text);}catch{/* Ordinary prose is not an extraction. */}
          if(Array.isArray(extraction?.records)&&extraction.records.length&&extraction.records.every((record:any)=>record&&typeof record==='object'&&!Array.isArray(record)&&typeof record.report_id==='string')){
            const call={id:randomUUID(),name:validator.name,args:{input_value:JSON.stringify({...sourceReference,records:extraction.records})}};
            calls.push(call);turn.parts.push({functionCall:call});bounded();recoveredExtraction=true;
          }
        }
        for(const part of turn.parts)if(typeof part.text==='string'&&!part.thought&&!validationFailure&&!recoveredExtraction)onEvent(createEvent(options.sessionId,'assistant_message',{chunk:part.text},meta));
        if(!calls.length){if(validationFailure)throw new ToolValidationError(validationFailure);session.history=history;return;}
        const results:Array<Record<string,unknown>>=[];
        for(const call of calls){
          if(++toolCalls>this.limits.maxToolCalls)throw new Error('Batas panggilan tool Gemini terlampaui.');
          if(typeof call.name!=='string'||!call.args||typeof call.args!=='object'||Array.isArray(call.args)||(call.id!=null&&typeof call.id!=='string'))throw new Error('Argumen tool Gemini tidak valid.');
          const name=canonicalToolName(call.name),tool=offered.find(t=>t.name===call.name);
          const callId=call.id??randomUUID();let output:unknown={error:{code:'TOOL_DENIED',message:'Tool atau operasi tidak diizinkan backend.'}};
          let modelOutput:unknown;
          let sourceMatches=true;
          if(name==='prepare_needs'&&options.filteredText!=null)sourceMatches=call.args.input_value===options.filteredText;
          if(name==='validate_needs'){
            try{const input=JSON.parse(call.args.input_value);sourceMatches=!!sourceReference&&input.batch_id===sourceReference.batch_id&&input.source_sha256===sourceReference.source_sha256;}
            catch{sourceMatches=false;}
          }
          if(!sourceMatches)output={error:{code:'SOURCE_MISMATCH',message:'Gunakan teks laporan asli dan SOURCE_REF dari prepare pada operasi ini persis.'}};
          if(tool&&name&&sourceMatches&&!(name==='upsert_shelter'&&writeDispatched)){
            const permission=await cancellable(gate(options.sessionId,{toolName:call.name,args:call.args,toolCallId:callId}),signal);
            signal.throwIfAborted();
            if(permission.allow){
              if(name==='upsert_shelter')writeDispatched=true;
              onEvent(createEvent(options.sessionId,'stage_changed',{stage:'tool:'+call.name},meta));
              const result=await session.mcp.callTool(call.name,call.args,signal);
              if(result.isError)throw new Error('Tool MCP gagal menyelesaikan operasi.');
              const resultText=result.content.filter(p=>p.type==='text').map(p=>p.text||'').join('\n').trimStart();
              const rejection=resultText.startsWith('GAGAL:')?resultText.split(/\r?\n/,1)[0]:undefined;
              if(name==='validate_needs'&&rejection){
                validationFailure=rejection.slice(0,1000);
                if(++validationFailures>=3)throw new ToolValidationError(validationFailure);
                results.push({functionResponse:{name:call.name,...(call.id?{id:call.id}:{}),response:{result:{error:{code:'TOOL_VALIDATION_FAILED',message:validationFailure,instruction:'Perbaiki records ekstraksi dari laporan bersih dengan SOURCE_REF yang sama. Gunakan nama posko dan angka eksplisit; header menentukan report_id. Jangan mengubah target atau memanggil write.'}}}}});
                continue;
              }
              output=result;modelOutput=compactToolResult(result);
              if(name==='validate_needs'){validated=true;validationFailure=undefined;}
              if(name==='prepare_needs'){
                const text=result.content.filter(part=>part.type==='text').map(part=>part.text||'').join('\n');
                const marker=/^\s*<<<SOURCE_REF>>>(.*?)<<<END_SOURCE_REF>>>/ms.exec(text);
                sourceReference=null;
                if(marker){
                  const reference=JSON.parse(marker[1]);
                  if(typeof reference.batch_id!=='string'||typeof reference.source_sha256!=='string')throw new Error('Tool MCP mengembalikan SOURCE_REF tidak valid.');
                  sourceReference=reference;
                }
              }
              for(const event of normalizeAcpNotification('session/update',{update:{sessionUpdate:'tool_call',name:call.name,toolCallId:callId,status:'completed',rawInput:call.args,rawOutput:result}},meta))onEvent(event);
            }else if(permission.reason)output={error:{code:'TOOL_DENIED',message:permission.reason}};
          }
          results.push({functionResponse:{name:call.name,...(call.id?{id:call.id}:{}),response:{result:modelOutput??output}}});
        }
        history.push({role:'user',parts:results});
        if(validated)shrinkConsumedPrepare(history,operationStart);
        bounded();
      }
      throw new Error('Batas putaran Gemini terlampaui.');
      }finally{
        if(total.requests)logger.info('LLM operasi selesai',{provider:this.provider,operation:options.operation,requests:total.requests,prompt_tokens:total.promptTokens,output_tokens:total.outputTokens,total_tokens:total.totalTokens});
      }
    }catch(error){
      // Kuota habis bersifat sementara: sesi dan riwayat operasi sebelumnya dipertahankan.
      if(!(error instanceof GeminiUnavailableError)&&!(error instanceof ModelProviderError&&error.temporary)&&!(error instanceof Error&&/^(Gemini kuota|Batas token)/.test(error.message)))await this.closeSession(options.sessionId);
      if(error instanceof ModelProviderError)throw error;
      if(error instanceof GeminiUnavailableError)throw error;
      if(error instanceof Error&&/^(Sesi Gemini|Riwayat Gemini|Gemini kuota|Batas token|Batas |Argumen tool Gemini|Respons Gemini|Operasi Gemini|Tool MCP|MCP )/.test(error.message))throw error;
      throw new Error('Runtime Gemini gagal atau timeout.');
    }finally{this.busy.delete(options.sessionId);}
  }
  async closeSession(sessionId:string):Promise<void>{
    const resource=this.resources.get(sessionId);resource?.lifetime.abort();await resource?.mcp.close();
    this.resources.delete(sessionId);this.sessions.delete(sessionId);
  }
  async shutdown():Promise<void>{this.stopped=true;for(const id of new Set([...this.sessions.keys(),...this.resources.keys()]))await this.closeSession(id);}
}
