import {test} from 'node:test';import assert from 'node:assert/strict';
import {compactToolResult,pruneHistory} from '../src/gemini/context.js';
import {GeminiAgentRuntime} from '../src/gemini/runtime.js';
import {call,done,scriptedModel,scenarioMcp} from './helpers/geminiScenario.js';
import type {GeminiTurn} from '../src/gemini/client.js';

const settings={apiKey:'synthetic-test-key',model:'gemini-3.8-flash'};
const allow=async()=>({allow:true});
const limits={keepFullOperations:1,maxOldStringChars:100,budgetBytes:1_000_000};
const big=(label:string)=>JSON.stringify({label,rows:Array.from({length:40},(_,i)=>({id:i,name:'Posko '+i}))});

test('hasil tool: salinan formatted dan raw yang sama hanya dikirim sekali',()=>{
  const payload=big('a');
  const pretty=JSON.stringify(JSON.parse(payload),null,2);
  const result=compactToolResult({content:[{type:'text',text:'Pratinjau:\n'+pretty+'\n\n'+payload},{type:'text',text:payload}],structuredContent:JSON.parse(payload)});
  const text=result.content.map(c=>c.text).join('\n');
  assert.equal(result.content.length,1);
  assert.equal(text.split('"Posko 39"').length-1,1);
  assert.equal('structuredContent' in result,false);
});

test('hasil tool: blok kecil, SOURCE_REF dan isError tidak berubah',()=>{
  const text='<<<SOURCE_REF>>>{"batch_id":"b","source_sha256":"h"}<<<END_SOURCE_REF>>>\nPosko Uji 10 jiwa.';
  const result=compactToolResult({content:[{type:'text',text}],isError:true});
  assert.equal(result.content[0].text,text);assert.equal(result.isError,true);
});

test('hasil tool: structuredContent dipertahankan bila tidak ada teks',()=>{
  const result=compactToolResult({content:[],structuredContent:{a:1}});
  assert.deepEqual(result.structuredContent,{a:1});
});

function operation(tool:string,tag:string,prompt='pertanyaan '+tag):GeminiTurn[]{
  return [
    {role:'user',parts:[{text:prompt}]},
    {role:'model',parts:[{functionCall:{id:tag,name:tool,args:{input_value:'x'.repeat(500)}}}]},
    {role:'user',parts:[{functionResponse:{name:tool,id:tag,response:{result:{content:[{type:'text',text:big(tag)}]}}}}]},
    {role:'model',parts:[{text:'jawaban '+tag}]},
  ];
}
const resultText=(turn:GeminiTurn)=>JSON.stringify((turn.parts[0] as any).functionResponse.response);

test('riwayat: operasi lama kehilangan hasil tool tetapi jawaban model tetap ada',()=>{
  const history=[...operation('sigap_3_calculate_gap','old'),...operation('sigap_3_calculate_gap','mid'),...operation('sigap_3_calculate_gap','last')];
  const pruned=pruneHistory(history,limits);
  assert.equal(pruned.length,12);
  assert.match(resultText(pruned[2]),/dihapus untuk menghemat token/);
  assert.doesNotMatch(resultText(pruned[2]),/Posko 39/);
  assert.match(resultText(pruned[6]),/dihapus untuk menghemat token/);
  assert.match(resultText(pruned[10]),/Posko 39/);
  assert.equal((pruned[3].parts[0] as any).text,'jawaban old');
  assert.match(JSON.stringify(pruned[1]),/dipotong/);
  assert.equal((pruned[2].parts[0] as any).functionResponse.id,'old');
});

test('riwayat: kandidat yang sedang ditinjau tidak dipangkas sampai ditulis',()=>{
  const candidate=operation('sigap_2_validate_needs','cand');
  const chats=[...operation('sigap_3_calculate_gap','c1'),...operation('sigap_3_calculate_gap','c2'),...operation('sigap_3_calculate_gap','c3')];
  const reviewing=pruneHistory([...candidate,...chats],limits);
  assert.match(resultText(reviewing[2]),/Posko 39/);
  assert.match(resultText(reviewing[6]),/dihapus/);
  const written=pruneHistory([...candidate,...operation('sigap_5_upsert_shelter','w'),...chats],limits);
  assert.match(resultText(written[2]),/dihapus/);
});

test('riwayat: operasi tertua dibuang saat melewati anggaran, kandidat dan operasi terbaru tetap',()=>{
  const history=[...operation('sigap_3_calculate_gap','a'),...operation('sigap_2_validate_needs','cand'),...operation('sigap_3_calculate_gap','b'),...operation('sigap_3_calculate_gap','c')];
  const pruned=pruneHistory(history,{...limits,budgetBytes:2500});
  const prompts=pruned.filter(t=>t.role==='user'&&(t.parts[0] as any).text).map(t=>(t.parts[0] as any).text);
  assert.equal(prompts.includes('pertanyaan a'),false);
  assert.equal(prompts.includes('pertanyaan cand'),true);
  assert.equal(prompts.at(-1),'pertanyaan c');
  assert.equal(pruned[0].role,'user');
});

test('runtime: model menerima satu salinan, event backend menerima hasil mentah, usage dicatat',async()=>{
  const payload=big('x');
  const mcp=await scenarioMcp(name=>name==='sigap_3_calculate_gap'?{content:[{type:'text',text:payload},{type:'text',text:payload}],structuredContent:JSON.parse(payload)}:undefined);
  const script=scriptedModel([call('sigap_3_calculate_gap',{input_value:'{}'}),done]);
  const usageSeen:any[]=[];
  const model={generate:async(c:any,t:any,i:any,s:any,onUsage?:any)=>{onUsage?.({promptTokens:10,outputTokens:2,totalTokens:12,cachedTokens:0,thoughtsTokens:0,toolUsePromptTokens:0});usageSeen.push(1);return script.model.generate(c,t,i,s);}};
  const runtime=new GeminiAgentRuntime(settings,model);const events:any[]=[];
  try{
    await runtime.initSession({sessionId:'one',contextId:'test',mcpServerConfig:[{name:'langflow',type:'http',url:mcp.url,headers:[]}]});
    await runtime.sendPrompt({sessionId:'one',batchId:'b',requestId:'r',prompt:'berapa kebutuhan air?',operation:'prepare'},e=>events.push(e),allow);
    const sent=JSON.stringify((script.inputs[1].contents[2].parts[0] as any).functionResponse.response);
    assert.equal(sent.split('Posko 39').length-1,1);
    assert.equal(sent.includes('structuredContent'),false);
    const raw=events.find(e=>e.event_type==='calculation_ready')?.payload.rawOutput;
    assert.equal(raw.split('Posko 39').length-1,2);
    assert.equal(usageSeen.length,2);
  }finally{await runtime.shutdown();await mcp.close();}
});

test('runtime: operasi kedua tidak membawa hasil tool operasi lama yang sudah tidak terlindungi',async()=>{
  const mcp=await scenarioMcp(name=>name==='sigap_3_calculate_gap'?{content:[{type:'text',text:big('gap')}]}:undefined);
  const script=scriptedModel([call('sigap_3_calculate_gap',{input_value:'{}'},'c1'),done,call('sigap_3_calculate_gap',{input_value:'{}'},'c2'),done,done]);
  const runtime=new GeminiAgentRuntime(settings,script.model);
  try{
    await runtime.initSession({sessionId:'one',contextId:'test',mcpServerConfig:[{name:'langflow',type:'http',url:mcp.url,headers:[]}]});
    for(const prompt of ['tanya 1','tanya 2','tanya 3'])await runtime.sendPrompt({sessionId:'one',batchId:'b',requestId:'r',prompt,operation:'prepare'},()=>{},allow);
    const last=script.inputs.at(-1)!.contents;
    const responses=last.filter(t=>t.parts.some((p:any)=>p.functionResponse)).map(t=>JSON.stringify(t));
    assert.equal(responses.length,2);
    assert.match(responses[0],/dihapus untuk menghemat token/);
    assert.match(responses[1],/Posko 39/);
  }finally{await runtime.shutdown();await mcp.close();}
});
