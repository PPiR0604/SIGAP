import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {FastifyRequest} from 'fastify';
import {rememberAuthorizedSession,requestSession} from '../src/auth/requestSession.js';
import type {Repository} from '../src/db/contract.js';
import type {SessionRecord} from '../src/db/repo.js';

test('request resources are immutable copies, ID-bound, and unavailable to another request',async()=>{
 const first={} as FastifyRequest,second={} as FastifyRequest;
 const original:SessionRecord={session_id:'mine',context_id:'allowed',created_at:'now',last_active_at:'now',status:'active'};
 const lookedUp:string[]=[];
 const repo={getSession:async(id:string)=>{lookedUp.push(id);return {session_id:id,context_id:'fresh'};}} as unknown as Repository;
 rememberAuthorizedSession(first,original);original.context_id='mutated';
 const checked=await requestSession(first,repo,'mine');assert.equal(checked?.context_id,'allowed');assert.ok(Object.isFrozen(checked));
 assert.equal((await requestSession(first,repo,'other'))?.context_id,'fresh');
 assert.equal((await requestSession(second,repo,'mine'))?.context_id,'fresh');
 assert.deepEqual(lookedUp,['other','mine']);
});
