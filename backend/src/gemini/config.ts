import {existsSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';import {fileURLToPath} from 'node:url';
export interface GeminiSettings {apiKey:string;model:string;/** Batas token input per menit untuk penjaga kuota; 0 = nonaktif. */tpmLimit?:number}
export function loadGeminiSettings():GeminiSettings{
  const path=process.env.SIGAP_GEMINI_CONFIG_PATH?resolve(process.env.SIGAP_GEMINI_CONFIG_PATH):fileURLToPath(new URL('../../data/gemini.local.json',import.meta.url));
  let local:any={};
  if(existsSync(path)){
    try{local=JSON.parse(readFileSync(path,'utf8'));if(!local||typeof local!=='object'||Array.isArray(local))throw new Error();}
    catch{throw new Error('Konfigurasi Gemini lokal tidak valid.');}
  }
  const envKey = process.env.GEMINI_API_KEY;
  const apiKey = (process.env.SIGAP_DOCKER === '1' && envKey === '')
    ? (local.apiKey ?? '')
    : (envKey ?? local.apiKey ?? '');
  const envModel = process.env.GEMINI_MODEL;
  const model = (process.env.SIGAP_DOCKER === '1' && envModel === '')
    ? (local.model ?? 'gemini-3.8-flash')
    : (envModel ?? local.model ?? 'gemini-3.8-flash');
  if(typeof apiKey!=='string'||typeof model!=='string'||!/^gemini-[a-z0-9.-]+$/.test(model))throw new Error('Konfigurasi Gemini lokal tidak valid.');
  const rawLimit=process.env.SIGAP_GEMINI_TPM_LIMIT??local.tpmLimit??200000;
  const tpmLimit=Number(rawLimit);
  if(!Number.isInteger(tpmLimit)||tpmLimit<0)throw new Error('Konfigurasi Gemini lokal tidak valid.');
  return {apiKey:apiKey.trim(),model,tpmLimit};
}
