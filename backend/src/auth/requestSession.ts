import type {FastifyRequest} from 'fastify';
import type {SessionRecord} from '../db/repo.js';
import type {Repository} from '../db/contract.js';

// Only the successful authorization hook populates this request-owned resource.
// Weak keys prevent retention beyond the request; no permission or cross-request cache.
const authorizedSessions=new WeakMap<FastifyRequest,Readonly<SessionRecord>>();
export function rememberAuthorizedSession(request:FastifyRequest,session:SessionRecord):void {
 authorizedSessions.set(request,Object.freeze({...session}));
}
export async function requestSession(request:FastifyRequest,repo:Repository,id:string):Promise<Readonly<SessionRecord>|null> {
 const checked=authorizedSessions.get(request);
 return checked?.session_id===id?checked:repo.getSession(id);
}
