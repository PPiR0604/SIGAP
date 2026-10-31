import type {FastifyPluginAsync} from 'fastify';
import {z} from 'zod';
import type {PublicPublicationService} from '../publications/service.js';
import {PublicationError} from '../publications/service.js';

export const publicBulletinPath=/^\/api\/public\/bulletins\/[A-Za-z0-9_-]{43}$/;
export function createPublicPublicationRoutes(service:PublicPublicationService):FastifyPluginAsync{return async app=>{
 const reads=new Map<string,{count:number;until:number}>();
 app.addHook('preHandler',async(req,reply)=>{
  if(!publicBulletinPath.test(req.url.split('?')[0]))return;
  const now=Date.now();for(const [key,value] of reads)if(value.until<=now)reads.delete(key);
  const entry=reads.get(req.ip)||{count:0,until:now+60000};
  if((reads.size>=10000&&!reads.has(req.ip))||++entry.count>60)return reply.code(429).header('Retry-After','60').send({error:{code:'RATE_LIMITED'}});
  reads.set(req.ip,entry);
 });
 app.addHook('onSend',async(_req,reply,payload)=>{reply.header('Cache-Control','no-store').header('Referrer-Policy','no-referrer').header('X-Robots-Tag','noindex, nofollow');return payload;});
 app.setErrorHandler((error,req,reply)=>{if(error instanceof PublicationError)return reply.code(error.status).send({error:{code:error.code}});throw error;});
 const id=(req:any)=>(req.params as {id:string}).id;
 app.get('/api/contexts/:id/publication-links',async(req,reply)=>{
  const context=z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/).safeParse(id(req));
  if(!context.success)return reply.code(422).send({error:{code:'INVALID_CONTEXT'}});
  return service.list(req.principal!,context.data);
 });
 app.get('/api/batches/:id/publication-preview',async req=>service.prepare(req.principal!,id(req)));
 app.get('/api/batches/:id/publication-link',async req=>({link:await service.currentLink(req.principal!,id(req))}));
 app.post('/api/batches/:id/publication/public',async(req,reply)=>{
  const body=z.object({review_id:z.string().regex(/^[a-f0-9]{32}$/),review_sha256:z.string().regex(/^[a-f0-9]{64}$/),public_acknowledged:z.literal(true)}).strict().safeParse(req.body);
  if(!body.success)return reply.code(422).send({error:{code:'PUBLIC_APPROVAL_REQUIRED'}});
  return service.publish(req.principal!,id(req),body.data.review_id,body.data.review_sha256);
 });
 app.delete('/api/batches/:id/publication-link/:shareId',async(req,reply)=>{
  const shareId=z.string().regex(/^[a-f0-9]{64}$/).safeParse((req.params as any).shareId);
  if(!shareId.success)return reply.code(422).send({error:{code:'INVALID_PUBLICATION'}});
  await service.revoke(req.principal!,id(req),shareId.data);return reply.code(204).send();
 });
 app.get('/api/public/bulletins/:token',async(req,reply)=>{
  const token=z.string().regex(/^[A-Za-z0-9_-]{43}$/).safeParse((req.params as any).token);
  if(!token.success)return reply.code(404).send({error:{code:'PUBLICATION_NOT_FOUND'}});
  const result=await service.read(token.data);
  return result??reply.code(404).send({error:{code:'PUBLICATION_NOT_FOUND'}});
 });
};}
