import {GoogleGenAI,type Content} from '@google/genai';
import type {McpTool} from '../mcp/httpClient.js';
import type {GeminiSettings} from './config.js';
import {logger} from '../logging.js';
import {setTimeout as delay} from 'node:timers/promises';
import {GeminiUnavailableError} from './errors.js';
export interface GeminiTurn {role:'user'|'model';parts:Array<Record<string,unknown>>}
export interface GeminiUsage {promptTokens:number;outputTokens:number;totalTokens:number;cachedTokens:number;thoughtsTokens:number;toolUsePromptTokens:number}
export interface GeminiModelClient {
  generate(contents:GeminiTurn[],tools:McpTool[],instruction:string,signal:AbortSignal,onUsage?:(usage:GeminiUsage)=>void):Promise<GeminiTurn>;
}
const MAX_DESCRIPTION_CHARS=400;
/** Deskripsi panjang pada deklarasi tool ikut terkirim di setiap request; dipotong agar hemat token. */
function slimText(text:string|undefined):string|undefined{return typeof text==='string'&&text.length>MAX_DESCRIPTION_CHARS?text.slice(0,MAX_DESCRIPTION_CHARS)+'…':text;}
export function slimSchema(value:unknown):unknown{
  if(Array.isArray(value))return value.map(slimSchema);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>
    [key,key==='description'&&typeof item==='string'&&item.length>MAX_DESCRIPTION_CHARS?item.slice(0,MAX_DESCRIPTION_CHARS)+'…':slimSchema(item)]));
  return value;
}
export class GeminiApiClient implements GeminiModelClient {
  private sdk:GoogleGenAI;
  constructor(private settings:GeminiSettings,sdk?:GoogleGenAI){
    this.sdk=sdk??new GoogleGenAI({apiKey:settings.apiKey,httpOptions:{timeout:60000,retryOptions:{attempts:1}}});
  }
  async generate(contents:GeminiTurn[],tools:McpTool[],instruction:string,signal:AbortSignal,onUsage?:(usage:GeminiUsage)=>void):Promise<GeminiTurn>{
    try{
      const requestSignal=AbortSignal.any([signal,AbortSignal.timeout(60000)]);
      const request=()=>this.sdk.models.generateContent({model:this.settings.model,contents:contents as Content[],config:{
        systemInstruction:instruction,abortSignal:requestSignal,
        automaticFunctionCalling:{disable:true},httpOptions:{timeout:60000,retryOptions:{attempts:1}},
        ...(tools.length?{tools:[{functionDeclarations:tools.map(tool=>({name:tool.name,description:slimText(tool.description),parametersJsonSchema:slimSchema(tool.inputSchema)}))}]}:{})
      }});
      let response:Awaited<ReturnType<typeof request>>|undefined;
      for(let attempt=0;attempt<2;attempt++){
        try{response=await request();break;}
        catch(error){
          if(Number((error as any)?.status??(error as any)?.code)!==503||attempt===1||requestSignal.aborted)throw error;
          logger.warn('Gemini temporarily unavailable; retrying model request once',{status:503});
          await delay(750,undefined,{signal:requestSignal});
        }
      }
      if(!response)throw new Error();
      const meta=response.usageMetadata;
      if(meta&&onUsage){
        // Pencatatan tidak boleh menggagalkan respons yang sudah diterima.
        try{onUsage({promptTokens:meta.promptTokenCount??0,outputTokens:meta.candidatesTokenCount??0,totalTokens:meta.totalTokenCount??0,
          cachedTokens:meta.cachedContentTokenCount??0,thoughtsTokens:meta.thoughtsTokenCount??0,toolUsePromptTokens:meta.toolUsePromptTokenCount??0});}catch{/* diabaikan */}
      }
      const candidate=response.candidates?.[0];
      if(response.promptFeedback?.blockReason||!candidate?.content?.parts?.length||(candidate.finishReason&&candidate.finishReason!=='STOP')){
        logger.warn('Gemini response incomplete',{finish_reason:candidate?.finishReason,blocked:!!response.promptFeedback?.blockReason,has_parts:!!candidate?.content?.parts?.length});
        throw new Error();
      }
      return { ...candidate.content,role:'model',parts:candidate.content.parts } as GeminiTurn;
    }catch(error){
      const status=(error as any)?.status??(error as any)?.code;
      logger.warn('Gemini request failed',{status:typeof status==='number'||typeof status==='string'?status:'unavailable'});
      if(Number(status)===503)throw new GeminiUnavailableError();
      if(status===429||/RESOURCE_EXHAUSTED/.test(String((error as any)?.message??'')))throw new Error('Gemini kuota habis atau dibatasi (429).');
      throw new Error('Gemini API gagal, dibatasi, memblokir respons, atau timeout.');
    }
  }
}
