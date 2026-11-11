import type {McpToolResult} from '../mcp/httpClient.js';

// Langflow ChatOutputResponse formats every newline for display, while MCP also
// returns Message.get_text(). Accept that exact, inspected transformation only.
const displayText=(text:string)=>text.replace(/\n\n/g,'\n').replace(/\n/g,'\n\n');

export function parsePreparedSource(result:McpToolResult):{reference:Record<string,unknown>;text:string} {
  const parts=result.content.filter(part=>part.type==='text'&&part.text?.trim()).map(part=>part.text!);
  if(result.isError||!parts.length)throw new Error('Sumber validasi tidak tersedia.');
  // Never concatenate independent source outputs or choose one arbitrarily.
  const canonical=[...parts].sort((a,b)=>a.length-b.length).find(candidate=>parts.every(part=>part===candidate||part===displayText(candidate)));
  if(!canonical)throw new Error('Keluaran sumber Langflow berbeda; validasi dihentikan.');
  const marker=/<<<SOURCE_REF>>>(.*?)<<<END_SOURCE_REF>>>/s.exec(canonical);
  if(!marker)throw new Error('Sumber validasi tidak tersedia.');
  if(canonical.split('<<<SOURCE_REF>>>').length!==2||canonical.split('<<<END_SOURCE_REF>>>').length!==2)
    throw new Error('Referensi sumber ambigu; validasi dihentikan.');
  const reference=JSON.parse(marker[1]);
  if(!reference||Array.isArray(reference)||typeof reference.batch_id!=='string'||!reference.batch_id||typeof reference.source_sha256!=='string'||!reference.source_sha256)
    throw new Error('Referensi sumber tidak valid.');
  return {reference,text:canonical.slice(marker.index!+marker[0].length).replace(/^\r?\n\r?\n/,'')};
}
