import {mcpServer} from './mcpServer.js';
import type {GeminiModelClient,GeminiTurn} from '../../src/gemini/client.js';
export const toolNames=['sigap_0_fetch_shelters','sigap_1_prepare_needs','sigap_2_validate_needs','sigap_3_calculate_gap','sigap_4_flag_anomalies','sigap_5_upsert_shelter','sigap_6_draft_bulletin'];
export const id='1'.repeat(32),sha='a'.repeat(64);
export const candidate={snapshot_id:id,snapshot_sha256:sha,records:[{report_id:'R001',shelter_name:'Posko Uji',village:'Desa Uji',total_people:10}],snapshot_records:[],issues:[],snapshot_issues:[]};
export function call(name:string,args:any={},id='call'):GeminiTurn{return {role:'model',parts:[{thoughtSignature:'opaque-signed-data',functionCall:{id,name,args}}]};}
export const done:GeminiTurn={role:'model',parts:[{text:'Hasil tersedia untuk ditinjau.'}]};
export function scriptedModel(turns:Array<GeminiTurn|((contents:GeminiTurn[])=>Promise<GeminiTurn>)>){
  const inputs:Array<{contents:GeminiTurn[];tools:any[];instruction:string}>=[];
  const model:GeminiModelClient={generate:async(contents,tools,instruction)=>{
    inputs.push({contents:structuredClone(contents),tools:structuredClone(tools),instruction});
    const turn=turns[inputs.length-1]??done;
    return typeof turn==='function'?await turn(contents):structuredClone(turn);
  }};
  return {model,inputs};
}
export async function scenarioMcp(result?:(name:string,args:any,res:any)=>any){
  return mcpServer((message,res)=>{
    res.setHeader('content-type','application/json');
    const reply=(value:any)=>res.end(JSON.stringify({jsonrpc:'2.0',id:message.id,result:value}));
    if(message.method==='initialize'){res.setHeader('mcp-session-id','test-session');reply({protocolVersion:'2025-03-26'});}
    else if(message.method==='notifications/initialized'){res.writeHead(202);res.end();}
    else if(message.method==='tools/list')reply({tools:toolNames.map(name=>({name,description:'Tool sintetis untuk regresi',inputSchema:{type:'object',properties:{input_value:{type:'string'}}}}))});
    else {
      const value=result?.(message.params.name,message.params.arguments,res);
      if(value===null)return;
      reply(value??{content:[{type:'text',text:message.params.name==='sigap_1_prepare_needs'?'<<<SOURCE_REF>>>{"batch_id":"source","source_sha256":"hash"}<<<END_SOURCE_REF>>>\nPosko Uji 10 jiwa. SIGAP_REFERENCE.':JSON.stringify(candidate)}]});
    }
  });
}
