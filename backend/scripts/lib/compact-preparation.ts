/** Fold the existing configured prompt into its producer, preserving live node IDs/auth edges. */
export function compactPreparation(data:any):void {
 const single=(name:string)=>{const found=data.nodes.filter((node:any)=>node.data?.node?.display_name===name);if(found.length!==1)throw Error('Unsupported preparation graph: '+name);return found[0];};
 const chat=single('Chat Input'),prepare=single('Posko Report Preprocessor'),output=single('Chat Output');
 const inputs=data.edges.filter((e:any)=>e.source===chat.id&&e.target===prepare.id);
 if(inputs.length!==2||!inputs.some((e:any)=>String(e.targetHandle).includes('sigap_context')))throw Error('Unsupported preparation connections');
 const prompts=data.nodes.filter((node:any)=>node.data?.node?.display_name==='Prompt Template');
 if(prompts.length===0){
  if(!prepare.data.node.template.extraction_template?.value||data.nodes.some((n:any)=>!([chat.id,prepare.id,output.id].includes(n.id)||n.type==='note'||n.data?.type==='note')))throw Error('Unsupported compact preparation graph');
  if(data.edges.length!==3||!data.edges.some((e:any)=>e.source===prepare.id&&e.target===output.id))throw Error('Unsupported compact preparation output');
  return;
 }
 if(prompts.length!==1)throw Error('Ambiguous preparation prompt');
 const prompt=prompts[0],template=prompt.data.node.template;
 if(template.use_double_brackets?.value||typeof template.template?.value!=='string')throw Error('Unsupported preparation template');
 const sources=data.edges.filter((e:any)=>e.source===prepare.id&&e.target===prompt.id);
 const targets=data.edges.filter((e:any)=>e.target===output.id);
 if(sources.length!==1||targets.length!==1)throw Error('Unsupported preparation connections');
 prepare.data.node.template.extraction_template={_input_type:'MultilineInput',name:'extraction_template',display_name:'Template Instruksi Ekstraksi',value:template.template.value,advanced:true,required:false,show:true,type:'str'};
 prepare.data.node.field_order=[...new Set([...(prepare.data.node.field_order??[]),'extraction_template'])];
 const source=sources[0],joined=structuredClone(targets[0]);
 joined.source=prepare.id;joined.sourceHandle=source.sourceHandle;joined.id='sigap-prepared-output';
 joined.data={...joined.data,sourceHandle:JSON.parse(source.sourceHandle.replaceAll('œ','"'))};
 data.nodes=[chat,prepare,output];data.edges=[...inputs,joined];
}
