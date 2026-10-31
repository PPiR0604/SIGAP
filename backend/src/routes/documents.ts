import type {FastifyPluginAsync} from 'fastify';
import type {Repository} from '../db/contract.js';
import {DocumentError,OCR_LIMITS,extractDocument} from '../documents/ocr.js';

export type DocumentExtractor=typeof extractDocument;
export function createDocumentsRoute(repo:Repository,extractor:DocumentExtractor=extractDocument):FastifyPluginAsync{return async app=>{
 app.addContentTypeParser('application/octet-stream',{parseAs:'buffer',bodyLimit:OCR_LIMITS.bytes},(_req,body,done)=>done(null,body));
 const running=new Set<string>();
 const attempts=new Map<string,{count:number;until:number}>();
 app.post('/api/sessions/:id/documents/extract',{bodyLimit:OCR_LIMITS.bytes},async(req,reply)=>{
  reply.header('Cache-Control','no-store');
  const sessionId=(req.params as {id:string}).id;
  if(!await repo.getSession(sessionId))return reply.code(404).send({error:{code:'SESSION_NOT_FOUND',message:'Sesi tidak ditemukan. Buka sesi yang aktif lalu coba lagi.'}});
  if(!Buffer.isBuffer(req.body))return reply.code(415).send({error:{code:'INVALID_DOCUMENT_BODY',message:'Unggah dokumen sebagai berkas biner.'}});
  let filename:string;
  try{const header=req.headers['x-document-name'];if(typeof header!=='string')throw new Error();filename=decodeURIComponent(header);}catch{return reply.code(422).send({error:{code:'INVALID_DOCUMENT_NAME',message:'Nama dokumen tidak valid.'}});}
  if(running.has(sessionId)||running.size>=2)return reply.code(429).header('Retry-After','5').send({error:{code:'OCR_BUSY',message:'Layanan sedang membaca dokumen lain. Tunggu sebentar lalu unggah kembali.'}});
  const now=Date.now();for(const [key,value]of attempts)if(value.until<=now)attempts.delete(key);
  const key=req.principal?.userId||sessionId;
  const attempt=attempts.get(key)||{count:0,until:now+60000};
  if(attempt.count>=12||attempts.size>=10000&&!attempts.has(key))return reply.code(429).header('Retry-After',String(Math.max(1,Math.ceil((attempt.until-now)/1000)))).send({error:{code:'OCR_RATE_LIMITED',message:'Batas pembacaan dokumen tercapai. Tunggu satu menit sebelum mencoba lagi.'}});
  attempt.count++;attempts.set(key,attempt);
  running.add(sessionId);
  const controller=new AbortController();
  const closed=()=>{if(!reply.raw.writableFinished)controller.abort();};reply.raw.on('close',closed);
  try{return reply.send(await extractor(req.body,filename,{signal:controller.signal}));}
  catch(error){if(error instanceof DocumentError)return reply.code(error.status).send({error:{code:error.code,message:error.message}});return reply.code(503).send({error:{code:'OCR_UNAVAILABLE',message:'Pembacaan dokumen belum tersedia. Coba lagi sebentar.'}});}
  finally{running.delete(sessionId);reply.raw.off('close',closed);}
 });
};}
