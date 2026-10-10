import {canonicalToolName} from '../acp/toolNames.js';
import type {McpToolResult} from '../mcp/httpClient.js';
import type {GeminiTurn} from './client.js';

type Part=Record<string,unknown>;

export interface HistoryLimits {
  /** Jumlah operasi sebelumnya (di luar operasi baru) yang hasil tool-nya tetap utuh. */
  keepFullOperations:number;
  /** Panjang maksimum string argumen/teks prompt pada operasi lama. */
  maxOldStringChars:number;
  /** Target ukuran riwayat (byte JSON). Operasi tertua dibuang bila terlampaui. */
  budgetBytes:number;
}

const MIN_DUPLICATE_CHARS=200;
const CANDIDATE_TOOLS=new Set(['validate_needs','prepare_needs']);

function jsonBytes(value:unknown):number{return Buffer.byteLength(JSON.stringify(value),'utf8');}

/** Kunci perbandingan: JSON dinormalkan (pretty vs minified dianggap sama), selain itu spasi diratakan. */
function chunkKey(chunk:string):string{
  const stripped=chunk.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
  const candidates=[stripped];
  const start=stripped.search(/[\[{]/);
  if(start>0&&start<200)candidates.push(stripped.slice(start));
  for(const candidate of candidates){
    try{return 'json:'+JSON.stringify(JSON.parse(candidate));}catch{/* bukan JSON utuh */}
  }
  return 'text:'+stripped.replace(/\s+/g,' ');
}

/**
 * Hapus blok besar yang muncul lebih dari sekali dalam teks yang sama atau antar bagian
 * (mis. versi terformat dan versi mentah dari output Langflow). Kemunculan pertama dipertahankan,
 * sehingga tidak ada informasi yang hilang; blok kecil tidak pernah disentuh.
 */
function dedupeText(text:string,seen:Set<string>):string{
  const chunks=text.split(/\r?\n{2,}/);
  const kept:string[]=[];
  for(const chunk of chunks){
    if(chunk.trim().length<MIN_DUPLICATE_CHARS){kept.push(chunk);continue;}
    const key=chunkKey(chunk);
    if(seen.has(key))continue;
    seen.add(key);kept.push(chunk);
  }
  return kept.join('\n\n');
}

/**
 * Bentuk hasil MCP yang dikirim ke Gemini. Event backend tetap memakai hasil mentah; hanya salinan
 * untuk model yang dipadatkan: bagian teks identik digabung, blok duplikat dibuang, dan
 * structuredContent dibuang bila teks sudah memuat isi yang sama.
 */
export function compactToolResult(result:McpToolResult):{content:Array<{type:string;text?:string}>;isError?:boolean;structuredContent?:unknown}{
  const seen=new Set<string>();
  const content:Array<{type:string;text?:string}>=[];
  for(const part of result.content){
    if(part?.type==='text'&&typeof part.text==='string'){
      const text=dedupeText(part.text,seen);
      if(!text.trim())continue;
      if(content.some(existing=>existing.type==='text'&&existing.text===text))continue;
      content.push({...part,text});
    }else content.push(part);
  }
  const hasText=content.some(part=>part.type==='text');
  return {content,...(result.isError?{isError:true}:{}),...(!hasText&&result.structuredContent!==undefined?{structuredContent:result.structuredContent}:{})};
}

/**
 * Setelah validate_needs berhasil, hasil prepare_needs (teks ekstraksi + SOURCE_REF) tidak lagi dibutuhkan model:
 * kandidat kanonis sudah ada di hasil validator. Diganti penanda singkat mulai indeks `fromIndex`
 * (awal operasi berjalan) supaya putaran berikutnya tidak membawa blok besar itu lagi.
 */
export function shrinkConsumedPrepare(history:GeminiTurn[],fromIndex=0):number{
  let shrunk=0;
  for(let index=fromIndex;index<history.length;index++){
    for(const part of history[index].parts){
      const response=part.functionResponse as {name?:unknown;response?:unknown}|undefined;
      if(!response||responseTool(part)!=='prepare_needs')continue;
      if(JSON.stringify(response.response).includes(CONSUMED_MARKER))continue;
      response.response={result:{content:[{type:'text',text:CONSUMED_MARKER}]}};shrunk++;
    }
  }
  return shrunk;
}
const CONSUMED_MARKER='[Hasil prepare_needs sudah dipakai validate_needs dan dihapus untuk menghemat token. Kandidat ada di hasil validate_needs.]';

function isOperationStart(turn:GeminiTurn):boolean{
  return turn.role==='user'&&turn.parts.some(part=>typeof part.text==='string')&&!turn.parts.some(part=>part.functionResponse);
}

function splitOperations(history:GeminiTurn[]):GeminiTurn[][]{
  const operations:GeminiTurn[][]=[];
  for(const turn of history){
    if(isOperationStart(turn)||!operations.length)operations.push([turn]);
    else operations[operations.length-1].push(turn);
  }
  return operations;
}

function responseTool(part:Part):string|null{
  const response=part.functionResponse as {name?:unknown}|undefined;
  return response?canonicalToolName(response.name):null;
}

function operationTools(operation:GeminiTurn[]):Set<string>{
  const tools=new Set<string>();
  for(const turn of operation)for(const part of turn.parts){const name=responseTool(part);if(name)tools.add(name);}
  return tools;
}

/** Operasi terbaru yang memuat kandidat rekap, kecuali sudah ditulis (upsert) sesudahnya. */
function protectedOperation(operations:GeminiTurn[][]):number{
  for(let index=operations.length-1;index>=0;index--){
    const tools=operationTools(operations[index]);
    if(tools.has('upsert_shelter'))return -1;
    if([...tools].some(name=>CANDIDATE_TOOLS.has(name)))return index;
  }
  return -1;
}

function truncateString(value:string,max:number):string{
  return value.length<=max?value:value.slice(0,max)+`…[dipotong, ${value.length-max} karakter lagi]`;
}

function truncateDeep(value:unknown,max:number):unknown{
  if(typeof value==='string')return truncateString(value,max);
  if(Array.isArray(value))return value.map(item=>truncateDeep(item,max));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,truncateDeep(item,max)]));
  return value;
}

function compactOldTurn(turn:GeminiTurn,max:number):GeminiTurn{
  return {...turn,parts:turn.parts.map(part=>{
    if(part.functionResponse){
      const response=part.functionResponse as Record<string,unknown>;
      return {...part,functionResponse:{...response,response:{result:{content:[{type:'text',
        text:`[Hasil ${String(response.name)} dari operasi lama dihapus untuk menghemat token. Panggil ulang tool bila datanya masih diperlukan.]`}]}}}};
    }
    if(part.functionCall){
      const call=part.functionCall as Record<string,unknown>;
      return {...part,functionCall:{...call,args:truncateDeep(call.args,max)}};
    }
    if(typeof part.text==='string'&&turn.role==='user')return {...part,text:truncateString(part.text,max)};
    return part;
  })};
}

/**
 * Pangkas riwayat lintas operasi sebelum operasi baru ditambahkan:
 * 1. operasi lama (di luar `keepFullOperations` terakhir) kehilangan hasil tool dan teks panjangnya,
 *    sementara jawaban model tetap ada sehingga percakapan tetap nyambung;
 * 2. operasi yang memuat kandidat rekap yang sedang ditinjau tidak disentuh;
 * 3. bila masih melebihi anggaran, operasi tertua yang tidak terlindungi dibuang utuh.
 */
export function pruneHistory(history:GeminiTurn[],limits:HistoryLimits):GeminiTurn[]{
  const operations=splitOperations(history);
  const keep=protectedOperation(operations);
  const firstFull=Math.max(0,operations.length-limits.keepFullOperations);
  let pruned=operations.map((operation,index)=>index===keep||index>=firstFull?operation:operation.map(turn=>compactOldTurn(turn,limits.maxOldStringChars)));
  const ids=pruned.map((_,index)=>index);
  let active=ids.slice();
  const size=()=>jsonBytes(active.flatMap(index=>pruned[index]));
  while(active.length>1&&size()>limits.budgetBytes){
    const drop=active.find(index=>index!==keep&&index<operations.length);
    if(drop===undefined||drop===active[active.length-1])break;
    active=active.filter(index=>index!==drop);
  }
  pruned=active.map(index=>pruned[index]);
  return pruned.flat();
}
