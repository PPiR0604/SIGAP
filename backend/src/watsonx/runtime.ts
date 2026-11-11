import {OpenAICompatibleRuntime} from '../openai/runtime.js';
import {OpenAIChatClient} from '../openai/client.js';
import {ModelProviderError} from '../openai/errors.js';

export interface WatsonxSettings {baseUrl:string; projectId:string; apiKey:string; model:string}

export function loadWatsonxSettings():WatsonxSettings {
  const baseUrl=(process.env.SIGAP_WATSONX_URL || 'https://us-south.ml.cloud.ibm.com').trim().replace(/\/+$/, '');
  const projectId=(process.env.SIGAP_WATSONX_PROJECT_ID || '').trim();
  const apiKey=(process.env.SIGAP_WATSONX_API_KEY || '').trim();
  const model=(process.env.SIGAP_WATSONX_MODEL || 'ibm/granite-4-h-small').trim();
  let url:URL;
  try { url=new URL(baseUrl); } catch { throw new Error('URL watsonx tidak valid.'); }
  if(url.protocol!=='https:' || !/^[a-z0-9-]+\.ml\.cloud\.ibm\.com$/.test(url.hostname) || url.port || url.username || url.password || url.pathname!=='/' || url.search || url.hash) throw new Error('URL watsonx harus endpoint IBM Cloud HTTPS.');
  if(!projectId || !apiKey || !model) throw new Error('Project ID, API key, dan model watsonx wajib diisi.');
  return {baseUrl:url.origin,projectId,apiKey,model};
}

/** Adapt the existing guarded tool loop to the IBM Cloud chat and IAM APIs. */
export function createWatsonxClient(settings:WatsonxSettings, request:typeof fetch=fetch):OpenAIChatClient {
  let token=''; let expiresAt=0;
  const proxy:typeof fetch=async (_input,init) => {
    const signal=init?.signal ?? undefined;
    const connect:typeof fetch=async (input,options)=>{
      try{return await request(input,options);}
      catch(error){
        if(signal?.aborted)throw error;
        const service=String(input).startsWith('https://iam.cloud.ibm.com/')?'IBM IAM':'watsonx.ai';
        throw new ModelProviderError('MODEL_CONNECTION_FAILED',`Tidak dapat menghubungi ${service}. Periksa koneksi internet dan DNS, lalu coba lagi.`,true);
      }
    };
    if(!token || Date.now()>=expiresAt){
      const response=await connect('https://iam.cloud.ibm.com/identity/token', {method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},body:new URLSearchParams({grant_type:'urn:ibm:params:oauth:grant-type:apikey',apikey:settings.apiKey}),signal,redirect:'error'});
      if(!response.ok){await response.body?.cancel();throw new ModelProviderError('MODEL_AUTH_ERROR','Autentikasi IBM IAM gagal. Periksa API key dan akses project.');}
      const data=await response.json() as {access_token?:unknown;expires_in?:unknown};
      if(typeof data.access_token!=='string' || !data.access_token || typeof data.expires_in!=='number' || data.expires_in<=0) throw new ModelProviderError('MODEL_AUTH_ERROR','Respons token IBM IAM tidak valid.');
      token=data.access_token; expiresAt=Date.now()+Math.max(0,data.expires_in-60)*1000;
    }
    const incoming=JSON.parse(String(init?.body)) as Record<string,unknown>;
    const {tool_choice,parallel_tool_calls,stream,reasoning_effort,...payload}=incoming;
    void tool_choice; void parallel_tool_calls; void stream; void reasoning_effort;
    const response=await connect(`${settings.baseUrl}/ml/v1/text/chat?version=2024-05-31`,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({...payload,project_id:settings.projectId,...(payload.tools?{tool_choice_option:'auto'}:{})}),signal,redirect:'error'});
    if(response.status===401){token='';expiresAt=0;}
    if(!response.ok)return response;
    const result=await response.json() as any;
    // Some Granite responses encode a JSON object inside a JSON string.
    // Normalize only that single extra layer; the shared client still validates the object.
    for(const choice of result?.choices ?? [])for(const call of choice?.message?.tool_calls ?? []){
      const raw=call?.function?.arguments;
      if(typeof raw!=='string')continue;
      try {const inner=JSON.parse(raw);if(typeof inner==='string'){const parsed=JSON.parse(inner);if(parsed && typeof parsed==='object' && !Array.isArray(parsed))call.function.arguments=JSON.stringify(parsed);}}catch{/* Invalid arguments are rejected by the shared client. */}
    }
    return Response.json(result,{status:response.status});
  };
  return new OpenAIChatClient({baseUrl:'http://localhost',apiKey:'',model:settings.model},proxy);
}

class WatsonxRuntime extends OpenAICompatibleRuntime {
  override readonly provider='watsonx' as const;
}

export function createWatsonxRuntime():OpenAICompatibleRuntime {
  const settings=loadWatsonxSettings();
  return new WatsonxRuntime({baseUrl:'http://localhost',apiKey:'watsonx-configured',model:settings.model},createWatsonxClient(settings));
}
