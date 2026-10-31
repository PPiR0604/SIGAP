import {ToolValidationError} from '../acp/errors.js';

const fields=new Set(['report_id','reported_at','shelter_name','village','shelter_type','total_people','total_families','male','female','infants_toddlers','children','elderly','pregnant','breastfeeding','disability','urgent_needs','surplus_do_not_send','notes','stock','stock_context','is_estimate']);

/** Model output contains extraction only; identity, provenance and consent belong to the server. */
export function parseExtraction(content:string,ids:Set<string>,maxBytes:number):Record<string,unknown>[] {
  const fail=(message:string):never=>{throw new ToolValidationError(message);};
  if(Buffer.byteLength(content,'utf8')>maxBytes)fail('Respons ekstraksi terlalu besar. Bagi laporan menjadi beberapa pesan.');
  const fenced=/^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(content.trim());
  let extracted:any;
  try{extracted=JSON.parse(fenced?.[1]??content);}catch{fail('Respons ekstraksi bukan JSON valid. Kirim ulang laporan; belum ada data disimpan.');}
  if(!Array.isArray(extracted?.records)||!extracted.records.length)fail('Tidak ditemukan laporan posko yang dapat divalidasi.');
  const seen=new Set<string>();
  for(const record of extracted.records){
    if(!record||typeof record!=='object'||Array.isArray(record)||typeof record.report_id!=='string'||!ids.has(record.report_id)||seen.has(record.report_id))fail('ID laporan hasil ekstraksi tidak sesuai sumber.');
    if(Object.keys(record).some(key=>!fields.has(key)))fail('Respons ekstraksi memuat field di luar data laporan. Belum ada data disimpan.');
    seen.add(record.report_id);
  }
  const pending:unknown[]=[extracted.records];
  while(pending.length){
    const value=pending.pop();
    if(typeof value==='number'&&!Number.isFinite(value))fail('Respons ekstraksi memuat angka di luar batas. Belum ada data disimpan.');
    if(value&&typeof value==='object')for(const item of Object.values(value))pending.push(item);
  }
  return extracted.records;
}
