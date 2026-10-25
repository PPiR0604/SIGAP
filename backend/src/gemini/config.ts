import '../config.js';
export interface GeminiSettings {apiKey:string;model:string;/** Batas token input per menit untuk penjaga kuota; 0 = nonaktif. */tpmLimit?:number}
export function loadGeminiSettings():GeminiSettings{
  const apiKey=process.env.GEMINI_API_KEY?.trim()||'';
  const model=process.env.GEMINI_MODEL?.trim()||'gemini-3.8-flash';
  if(typeof apiKey!=='string'||typeof model!=='string'||!/^gemini-[a-z0-9.-]+$/.test(model))throw new Error('Konfigurasi Gemini lokal tidak valid.');
  const rawLimit=process.env.SIGAP_GEMINI_TPM_LIMIT??200000;
  const tpmLimit=Number(rawLimit);
  if(!Number.isInteger(tpmLimit)||tpmLimit<0)throw new Error('Konfigurasi Gemini lokal tidak valid.');
  return {apiKey:apiKey.trim(),model,tpmLimit};
}
