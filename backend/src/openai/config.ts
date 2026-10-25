import '../config.js';

export interface OpenAISettings {baseUrl:string;apiKey:string;model:string}
export function loadOpenAISettings():OpenAISettings{
  const baseUrl=process.env.SIGAP_OPENAI_BASE_URL?.trim()||'http://localhost:20128/v1';
  const apiKey=process.env.SIGAP_OPENAI_API_KEY?.trim()||'';
  const model=process.env.SIGAP_OPENAI_MODEL?.trim()||'ag/gemini-3.8-flash-high';
  if([baseUrl,apiKey,model].some(v=>typeof v!=='string')||!model.trim())throw new Error('Konfigurasi endpoint LLM lokal tidak valid.');
  let url:URL;
  try{url=new URL(baseUrl);}catch{throw new Error('URL endpoint LLM tidak valid.');}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||!['localhost','127.0.0.1','[::1]','host.docker.internal'].includes(url.hostname))throw new Error('Endpoint LLM harus HTTP lokal tanpa kredensial pada URL.');
  if(process.env.SIGAP_DOCKER==='1'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname))url.hostname='host.docker.internal';
  return {baseUrl:url.toString().replace(/\/+$/,''),apiKey:apiKey.trim(),model:model.trim()};
}
