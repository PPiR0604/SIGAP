import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parsePreparedSource} from '../src/gemini/preparedSource.js';

const ref={batch_id:'source',source_sha256:'hash'};
const body='[R001] waktu=- | pelapor=-\nPosko A, 0 jiwa.\n\n[R002] waktu=- | pelapor=-\nPosko B, 5 jiwa; stok 20 L untuk 48 jam.\n';
const raw='Instruksi tetap\nJSON {"records":[]}\n\n<<<SOURCE_REF>>>'+JSON.stringify(ref)+'<<<END_SOURCE_REF>>>\n\n'+body;
const display=(text:string)=>text.replace(/\n\n/g,'\n').replace(/\n/g,'\n\n');
const result=(parts:string[])=>({content:parts.map(text=>({type:'text',text}))});

test('selects exact raw source from native display and Message outputs in either order',()=>{
  for(const parts of [[display(raw),raw],[raw,display(raw)],[raw,raw],[raw],[display(raw),raw,display(raw)]])
    assert.deepEqual(parsePreparedSource(result(parts)),{reference:ref,text:body});
});

test('source selection rejects conflicting content, references, instructions and unsupported formatting',()=>{
  for(const other of [raw.replace('5 jiwa','6 jiwa'),raw.replace('source"','other"'),raw.replace('hash"','different"'),raw.replace('Instruksi tetap','Instruksi lain'),raw+'\n',raw.replace('Posko A','Posko  A'),'Status: selesai'])
    assert.throws(()=>parsePreparedSource(result([raw,other])),/berbeda/);
});

test('malformed, empty and nested references fail closed',()=>{
  for(const parts of [[],[''],['Laporan tanpa referensi'],[raw.replace(JSON.stringify(ref),'null')],[raw.replace(JSON.stringify(ref),'{"batch_id":"","source_sha256":"x"}')],[raw+'<<<SOURCE_REF>>>{}<<<END_SOURCE_REF>>>']])
    assert.throws(()=>parsePreparedSource(result(parts)));
  assert.throws(()=>parsePreparedSource({...result([raw]),isError:true}));
});
