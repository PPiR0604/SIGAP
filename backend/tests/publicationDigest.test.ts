import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {digest,legacyPublicDigest,publicBulletinPayload,publicPayloadVerified} from '../src/publications/payload.js';

const reordered=(value:any):any=>Array.isArray(value)?value.map(reordered):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).reverse().map(key=>[key,reordered(value[key])])):value;
const fixture=()=>publicBulletinPayload({content:'# Buletin\nData publik.',source_metadata:{snapshot_sha256:'a'.repeat(64),kind:'stored',records:[{shelter_name:'Posko A',village:'A',total_people:10,infants_toddlers:0}]}},{shelters:[{shelter_name:'Posko A',village:'A',needs:{air_liter_per_hari:{value:150}},gaps:{air_liter_per_hari:0},planning:{schema_version:'sphere2018-population-v1',complete_age_counts:false,nutrition:{energy_kcal:21000,protein_g:530,fat_g:400,carbohydrate_equivalent_g:3820},age_groups:[{key:'under5',people:0,water_l:0,energy_kcal:0},{key:'children',people:null,water_l:null,energy_kcal:null},{key:'adults',people:null,water_l:null,energy_kcal:null},{key:'elderly',people:null,water_l:null,energy_kcal:null}]}}]});

test('public checksum survives JSONB object ordering while retaining arrays, unknowns and zero',()=>{
 const payload=fixture(),readback=reordered(payload),sha=digest(payload);
 assert.notEqual(JSON.stringify(readback),JSON.stringify(payload));assert.equal(digest(readback),sha);
 assert.equal(publicPayloadVerified({payload:readback,digest_scheme:'canonical-json-v1',review_sha256:sha}),true);
 const altered=structuredClone(readback);altered.records[0].requirements.air_liter_per_hari=151;
 assert.equal(publicPayloadVerified({payload:altered,digest_scheme:'canonical-json-v1',review_sha256:sha}),false);
 const swapped=structuredClone(readback);swapped.records[0].planning.age_groups.reverse();assert.notEqual(digest(swapped),sha);
 const missing=structuredClone(readback);missing.records[0].infants_toddlers=null;assert.notEqual(digest(missing),sha);
 assert.equal(digest('unchanged-token'),createHash('sha256').update('unchanged-token').digest('hex'));
});

test('legacy links verify the exact approved schema without rewriting data or admitting extra fields',()=>{
 const payload=fixture(),oldHash=createHash('sha256').update(JSON.stringify(payload)).digest('hex'),readback=reordered(payload);
 assert.equal(legacyPublicDigest(readback),oldHash);assert.equal(publicPayloadVerified({payload:readback,review_sha256:oldHash}),true);
 const changed=structuredClone(readback);changed.content+=' Changed';assert.equal(publicPayloadVerified({payload:changed,review_sha256:oldHash}),false);
 const extra=structuredClone(readback);extra.records[0].private_source='must not be admitted';assert.equal(legacyPublicDigest(extra),null);
 assert.equal(publicPayloadVerified({payload:readback,digest_scheme:'future-unknown',review_sha256:oldHash}),false);
});

test('public projection retains reported quantity and unit while omitting unverified fields',()=>{
 const payload=publicBulletinPayload({content:'Draf',source_metadata:{records:[{shelter_name:'A',urgent_needs:[{item:'Beras',qty:10,unit:'kg',source_excerpt:'private'},{item:'Selimut',qty:0,unit:'lembar'},{item:'Obat',qty:5,unit:null},'Air bersih (300 liter)','ibu hamil ada 17']}]}},null);
 assert.deepEqual(payload.records[0].urgent_needs,[{item:'Beras',qty:10,unit:'kg'},{item:'Selimut',qty:0,unit:'lembar'},'Obat',{item:'Air bersih',qty:300,unit:'liter'},'ibu hamil ada 17']);
 assert.doesNotMatch(JSON.stringify(payload),/private|source_excerpt/);
});
