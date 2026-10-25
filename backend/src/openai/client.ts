import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import type {GeminiModelClient,GeminiTurn,GeminiUsage} from '../gemini/client.js';
import {slimSchema} from '../gemini/client.js';
import type {McpTool} from '../mcp/httpClient.js';
import type {OpenAISettings} from './config.js';
import {ModelProviderError} from './errors.js';

/** Translate the shared manual-tool loop to Chat Completions. No tool executes in this client. */
export function chatMessages(contents:GeminiTurn[],instruction:string):any[]{
  const messages:any[]=[{role:'system',content:instruction}];
  for(const turn of contents){
    const text=turn.parts.filter(p=>typeof p.text==='string'&&!p.thought).map(p=>p.text).join('\n');
    if(turn.role==='model'){
      const calls=turn.parts.filter(p=>p.functionCall).map(p=>{const c=p.functionCall as any;return {id:c.id,type:'function',function:{name:c.name,arguments:JSON.stringify(c.args)}};});
      const reasoning=turn.parts.find(p=>typeof p.reasoning_content==='string')?.reasoning_content;
      messages.push({role:'assistant',content:text||null,...(calls.length?{tool_calls:calls}:{}),...(reasoning!==undefined?{reasoning_content:reasoning}:{})});
    }else{
      if(text)messages.push({role:'user',content:text});
      for(const p of turn.parts){
        if(!p.functionResponse)continue;
        const result=p.functionResponse as any;
        if(typeof result.id!=='string')throw new ModelProviderError('MODEL_PROTOCOL_ERROR','Respons tool kehilangan identitas panggilan. Mulai ulang sesi.');
        messages.push({role:'tool',tool_call_id:result.id,content:JSON.stringify(result.response)});
      }
    }
  }
  return messages;
}

export class OpenAIChatClient implements GeminiModelClient {
  constructor(private settings:OpenAISettings,private request:typeof fetch=fetch){}
  async generate(contents:GeminiTurn[],tools:McpTool[],instruction:string,signal:AbortSignal,onUsage?:(usage:GeminiUsage)=>void):Promise<GeminiTurn>{
    const requestSignal=AbortSignal.any([signal,AbortSignal.timeout(120000)]);
    // Keep the user's model spec in configuration/health; send effort as a separate API parameter.
    const spec=/^(.+)\((none|minimal|low|medium|high|xhigh)\)$/.exec(this.settings.model);
    const payload={model:spec?.[1]??this.settings.model,...(spec?{reasoning_effort:spec[2]}:{}),messages:chatMessages(contents,instruction),stream:false,max_tokens:8192,
      ...(tools.length?{tools:tools.map(t=>({type:'function',function:{name:t.name,description:t.description?.slice(0,400),parameters:slimSchema(t.inputSchema)}})),tool_choice:'auto',parallel_tool_calls:false}:{})};
    try{
      let result:any;
      for(let attempt=0;attempt<2;attempt++){
        const response=await this.request(this.settings.baseUrl+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',...(this.settings.apiKey?{Authorization:`Bearer ${this.settings.apiKey}`}:{})},body:JSON.stringify(payload),signal:requestSignal,redirect:'error'});
        if(response.status===503&&attempt===0){await response.body?.cancel();await delay(750,undefined,{signal:requestSignal});continue;}
        if(!response.ok){
          await response.body?.cancel();
          if(response.status===401||response.status===403)throw new ModelProviderError('MODEL_AUTH_ERROR','API key endpoint LLM ditolak. Periksa konfigurasi backend.');
          if(response.status===429)throw new ModelProviderError('MODEL_RATE_LIMIT','Endpoint LLM membatasi kuota (429). Tunggu sebentar lalu coba lagi.',true);
          if(response.status===503)throw new ModelProviderError('MODEL_UNAVAILABLE','Endpoint LLM sementara tidak tersedia (503). Tunggu sebentar lalu coba lagi.',true);
          throw new ModelProviderError('MODEL_REQUEST_FAILED',`Permintaan ke endpoint LLM gagal (HTTP ${response.status}).`);
        }
        result=await response.json();break;
      }
      const choice=result?.choices?.[0],message=choice?.message;
      if(!message||!['stop','tool_calls'].includes(choice.finish_reason)||message.refusal)throw new ModelProviderError('MODEL_INCOMPLETE','Respons LLM kosong, terpotong, atau ditolak. Klarifikasi belum selesai.');
      const parts:Array<Record<string,unknown>>=[];
      if(typeof message.reasoning_content==='string')parts.push({reasoning_content:message.reasoning_content});
      if(typeof message.content==='string'&&message.content.trim())parts.push({text:message.content});
      const ids=new Set<string>();
      for(const tool of message.tool_calls||[]){
        const args=JSON.parse(tool.function?.arguments);
        if(tool.type!=='function'||typeof tool.function?.name!=='string'||!args||typeof args!=='object'||Array.isArray(args))throw new ModelProviderError('MODEL_PROTOCOL_ERROR','Argumen tool dari LLM tidak valid; tidak dijalankan.');
        const id=typeof tool.id==='string'&&tool.id?tool.id:randomUUID();
        if(ids.has(id))throw new ModelProviderError('MODEL_PROTOCOL_ERROR','ID panggilan tool dari LLM duplikat; tidak dijalankan.');
        ids.add(id);parts.push({functionCall:{id,name:tool.function.name,args}});
      }
      if(!parts.some(p=>p.text||p.functionCall))throw new ModelProviderError('MODEL_INCOMPLETE','Respons LLM tidak berisi jawaban atau panggilan tool.');
      if(result.usage&&onUsage){try{onUsage({promptTokens:result.usage.prompt_tokens??0,outputTokens:result.usage.completion_tokens??0,totalTokens:result.usage.total_tokens??0,cachedTokens:result.usage.prompt_tokens_details?.cached_tokens??0,thoughtsTokens:result.usage.completion_tokens_details?.reasoning_tokens??0,toolUsePromptTokens:0});}catch{/* Usage recording must not fail a valid response. */}}
      return {role:'model',parts};
    }catch(error){
      if(error instanceof ModelProviderError)throw error;
      if(requestSignal.aborted)throw new ModelProviderError('MODEL_TIMEOUT','Endpoint LLM melewati batas waktu atau operasi dibatalkan. Coba lagi sebentar.',true);
      throw new ModelProviderError('MODEL_CONNECTION_FAILED','Endpoint LLM tidak dapat dihubungi atau responsnya tidak valid. Periksa layanan proxy lokal.',true);
    }
  }
}
