import {randomBytes} from 'node:crypto';
import {AccessError,type AuthService,type Principal} from '../auth/service.js';
import type {Repository} from '../db/contract.js';
import type {BatchOrchestrator} from '../pipeline/orchestrator.js';
import {draftFingerprint,digest,publicBulletinPayload,publicPayloadVerified,type PublicBulletinPayload} from './payload.js';

export class PublicationError extends Error{constructor(readonly code:string,readonly status=409){super(code);}}
type Review={batchId:string;actorId:string;organizationId:string;fingerprint:string;contentHash:string;sha:string;data:PublicBulletinPayload;expiresAt:number};
const kind='public_bulletins';

export class PublicPublicationService {
 private reviews=new Map<string,Review>();
 private publishing=new Set<string>();
 constructor(private repo:Repository,private auth:AuthService,private orchestrator:BatchOrchestrator){}
 private async batch(principal:Principal,batchId:string){
  this.auth.active(principal);if(principal.membership.role!=='admin')throw new AccessError(403,'ADMIN_REQUIRED');
  const batch=await this.repo.getBatch(batchId);
  await this.auth.session(principal,batch?await this.repo.getSession(batch.session_id):null);
  if(!batch?.bulletin_payload_json)throw new PublicationError('BULLETIN_UNAVAILABLE');
  return batch;
 }
 async prepare(principal:Principal,batchId:string){
  const batch=await this.batch(principal,batchId),draft=JSON.parse(batch.bulletin_payload_json!);
  if(!draft.content?.trim()||digest(draft.content)!==draft.content_sha256)throw new PublicationError('PREVIEW_CHANGED');
  this.orchestrator.setPrincipal(batch.session_id,principal);
  let calculation:any=null;
  try{calculation=await this.orchestrator.readBulletinCalculation(batch);}catch{/* Never substitute current workspace data for an unavailable original source. */}
  const current=await this.repo.getBatch(batchId);
  if(!current||draftFingerprint(current)!==draftFingerprint(batch))throw new PublicationError('PREVIEW_CHANGED');
  const data=publicBulletinPayload(draft,calculation),sha=digest(data),reviewId=randomBytes(16).toString('hex');
  for(const [key,review] of this.reviews)if(review.expiresAt<=Date.now())this.reviews.delete(key);
  if(this.reviews.size>=200)this.reviews.delete(this.reviews.keys().next().value!);
  this.reviews.set(reviewId,{batchId,actorId:principal.userId,organizationId:principal.membership.organization_id!,fingerprint:draftFingerprint(batch),contentHash:digest(draft.content),sha,data,expiresAt:Date.now()+15*60000});
  return {review_id:reviewId,review_sha256:sha,data};
 }
 private async links(batchId:string){return this.auth.gateway.call<any[]>('entity.list',{kind,filter:{batch_id:batchId,organization_id:this.auth.gateway.settings.organizationId}});}
 private descriptor(document:any){return {share_id:document.share_id,path:`/publikasi/${document.token}`,approved_at:document.approved_at};}
 async currentLink(principal:Principal,batchId:string){
  const batch=await this.batch(principal,batchId);
  const document=(await this.links(batchId)).filter(d=>d.active&&d.public_acknowledged===true&&publicPayloadVerified(d)&&d.draft_fingerprint===draftFingerprint(batch)).at(-1);
  return document?this.descriptor(document):null;
 }
 async list(principal:Principal,contextId:string){
  this.auth.active(principal);if(principal.membership.role!=='admin')throw new AccessError(403,'ADMIN_REQUIRED');
  await this.auth.scope(principal,contextId);
  const links=await this.auth.gateway.call<any[]>('entity.list',{kind,filter:{organization_id:principal.membership.organization_id,context_id:contextId}});
  return links.map(link=>({...this.descriptor(link),batch_id:link.batch_id,active:link.active===true,source_version:link.payload?.source?.version||null})).reverse();
 }
 async publish(principal:Principal,batchId:string,reviewId:string,sha:string){
  if(this.publishing.has(batchId))throw new PublicationError('PUBLICATION_BUSY');
  this.publishing.add(batchId);
  try{
   const batch=await this.batch(principal,batchId),review=this.reviews.get(reviewId);
   if(!review||review.expiresAt<=Date.now()||review.batchId!==batchId||review.actorId!==principal.userId||review.organizationId!==principal.membership.organization_id||review.sha!==sha)throw new PublicationError('PUBLICATION_REVIEW_EXPIRED');
   if(review.fingerprint!==draftFingerprint(batch))throw new PublicationError('PREVIEW_CHANGED');
   const existing=(await this.links(batchId)).find(d=>d.active&&d.public_acknowledged===true&&publicPayloadVerified(d)&&d.draft_fingerprint===review.fingerprint&&d.review_sha256===sha);
   if(existing)return this.descriptor(existing);
   const publications=await this.auth.gateway.call<any[]>('publications.list',{actor_id:principal.userId});
   let approved=publications.find(p=>p.context_id===batch.context_id&&p.content_sha256===review.contentHash);
   approved??=await this.auth.gateway.call('publication.approve',{actor_id:principal.userId,context_id:batch.context_id,batch_id:batchId,content_sha256:review.contentHash});
   if(!approved?.id)throw new PublicationError('PUBLICATION_NOT_VERIFIED');
   const current=await this.repo.getBatch(batchId);
   if(!current||draftFingerprint(current)!==review.fingerprint)throw new PublicationError('PREVIEW_CHANGED');
   const token=randomBytes(32).toString('base64url'),shareId=digest(token);
   const document={share_id:shareId,token,active:true,organization_id:review.organizationId,batch_id:batchId,context_id:batch.context_id,
    publication_id:approved.id,draft_fingerprint:review.fingerprint,review_sha256:sha,digest_scheme:'canonical-json-v1',approved_at:new Date().toISOString(),approved_by:principal.userId,public_acknowledged:true,payload:review.data};
   await this.auth.gateway.call('entity.put',{kind,id:shareId,document});
   const readback=await this.auth.gateway.call('entity.get',{kind,id:shareId});
   if(!readback?.active||readback.review_sha256!==sha||!publicPayloadVerified(readback))throw new PublicationError('PUBLICATION_NOT_VERIFIED');
   return this.descriptor(readback);
  }finally{this.publishing.delete(batchId);}
 }
 async revoke(principal:Principal,batchId:string,shareId:string){
  await this.batch(principal,batchId);
  const link=await this.auth.gateway.call('entity.get',{kind,id:shareId});
  if(!link||link.batch_id!==batchId||link.organization_id!==principal.membership.organization_id)throw new PublicationError('PUBLICATION_NOT_FOUND',404);
  await this.auth.gateway.call('entity.patch',{kind,id:shareId,patch:{active:false,revoked_at:new Date().toISOString(),revoked_by:principal.userId},expected:{active:true}});
 }
 async read(token:string){
  const link=await this.auth.gateway.call('entity.get',{kind,id:digest(token)});
  if(!link?.active||link.public_acknowledged!==true||link.organization_id!==this.auth.gateway.settings.organizationId||!publicPayloadVerified(link))return null;
  return {...link.payload,approved_at:link.approved_at};
 }
}
