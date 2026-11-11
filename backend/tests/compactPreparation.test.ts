import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compactPreparation} from '../scripts/lib/compact-preparation.js';

test('compact preparation preserves authenticated inputs, configured prompt and output node IDs',()=>{
 const data=JSON.parse(readFileSync('../langflow/flows/prepare_needs.json','utf8')).data;
 const chat=data.nodes.find((n:any)=>n.data.node?.display_name==='Chat Input');
 const prepare=data.nodes.find((n:any)=>n.data.node?.display_name==='Posko Report Preprocessor');
 const prompt=data.nodes.find((n:any)=>n.data.node?.display_name==='Prompt Template');
 const output=data.nodes.find((n:any)=>n.data.node?.display_name==='Chat Output');
 const template=prompt.data.node.template.template.value;
 // Live installer adds this dedicated capability connection before compacting.
 const input=structuredClone(data.edges.find((e:any)=>e.source===chat.id&&e.target===prepare.id));
 input.id='auth';input.targetHandle='sigap_context';data.edges.push(input);
 const authInputs=structuredClone(data.edges.filter((e:any)=>e.source===chat.id&&e.target===prepare.id));
 compactPreparation(data);
 assert.deepEqual(data.nodes.map((n:any)=>n.id),[chat.id,prepare.id,output.id]);
 assert.deepEqual(data.edges.slice(0,2),authInputs);
 assert.equal(prepare.data.node.template.extraction_template.value,template);
 assert.equal(data.edges.at(-1).source,prepare.id);assert.equal(data.edges.at(-1).target,output.id);
 assert.equal(data.edges.length,3);
 const once=structuredClone(data);compactPreparation(data);assert.deepEqual(data,once);
 data.edges=data.edges.filter((e:any)=>e.id!=='auth');
 assert.throws(()=>compactPreparation(data),/preparation connections/);
});

test('ambiguous or missing preparation/auth connections fail before installation',()=>{
 for(const mode of ['no-auth','duplicate-prompt','mustache']){
  const data=JSON.parse(readFileSync('../langflow/flows/prepare_needs.json','utf8')).data;
  const prompt=data.nodes.find((n:any)=>n.data.node?.display_name==='Prompt Template');
  if(mode==='duplicate-prompt')data.nodes.push(structuredClone(prompt));
  if(mode==='mustache')prompt.data.node.template.use_double_brackets.value=true;
  assert.throws(()=>compactPreparation(data),/preparation/);
 }
});
