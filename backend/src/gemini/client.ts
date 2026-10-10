import {GoogleGenAI,type Content} from '@google/genai';
import type {McpTool} from '../mcp/httpClient.js';
import type {GeminiSettings} from './config.js';
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
      const response=await this.sdk.models.generateContent({model:this.settings.model,contents:contents as Content[],config:{
        systemInstruction:instruction,abortSignal:AbortSignal.any([signal,AbortSignal.timeout(60000)]),
        automaticFunctionCalling:{disable:true},httpOptions:{timeout:60000,retryOptions:{attempts:1}},
        ...(tools.length?{tools:[{functionDeclarations:tools.map(tool=>({name:tool.name,description:slimText(tool.description),parametersJsonSchema:slimSchema(tool.inputSchema)}))}]}:{})
      }});
      const meta=response.usageMetadata;
      if(meta&&onUsage){
        // Pencatatan tidak boleh menggagalkan respons yang sudah diterima.
        try{onUsage({promptTokens:meta.promptTokenCount??0,outputTokens:meta.candidatesTokenCount??0,totalTokens:meta.totalTokenCount??0,
          cachedTokens:meta.cachedContentTokenCount??0,thoughtsTokens:meta.thoughtsTokenCount??0,toolUsePromptTokens:meta.toolUsePromptTokenCount??0});}catch{/* diabaikan */}
      }
      const candidate=response.candidates?.[0];
      if(response.promptFeedback?.blockReason||!candidate?.content?.parts?.length||(candidate.finishReason&&candidate.finishReason!=='STOP'))throw new Error();
      return { ...candidate.content,role:'model',parts:candidate.content.parts } as GeminiTurn;
    }catch(error){
      const status=(error as any)?.status??(error as any)?.code;
      if(status===429||/RESOURCE_EXHAUSTED/.test(String((error as any)?.message??'')))throw new Error('Gemini kuota habis atau dibatasi (429).');
      throw new Error('Gemini API gagal, dibatasi, memblokir respons, atau timeout.');
    }
  }
}
