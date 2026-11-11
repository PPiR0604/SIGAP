import type {SigapReadResult} from './toolResults.js';

export function isCorrectionRequest(text:string):boolean {
  return /^(?:(?:mohon|tolong)\s+)?(?:klarifikasi|koreksi|ralat|perbaiki|ubah|update|pembaruan)\b/i.test(text.trim()) && /\d/.test(text);
}

export class CorrectionTargetError extends Error {
  constructor(public kind:'missing'|'ambiguous',message:string){super(message);}
}

export function correctionInput(text:string,readback:SigapReadResult,candidate=false):string {
  if(!readback.snapshot_id||!readback.snapshot_sha256)throw new Error('Rekap belum memiliki referensi read-back.');
  const report=/\blaporan\s+(R\d+)\b/i.exec(text)?.[1]?.toUpperCase();
  const batch=/\bbatch\s+([a-f0-9]{32})\b/i.exec(text)?.[1];
  const normalize=(value:unknown)=>String(value??'').toLowerCase().replace(/\b(?:posko|desa|kelurahan)\b/g,'').replace(/[^a-z0-9]+/g,' ').trim();
  const subject=text.split(/[:\n]/,1)[0];
  const bracket=/\(([^)]+)\)/.exec(subject)?.[1];
  const named=/\bposko\s+(.+)$/i.exec(subject)?.[1];
  const name=normalize(bracket??named??'');
  // Nama lengkap harus ada pada bagian target pesan; tidak memakai substring antarnama posko.
  const candidates=(readback.records??[]).map((record,index)=>({record,index})).filter(({record})=>{
    const identities=candidate?[record,...(record.update_target?[record.update_target]:[]),...(Array.isArray(record.candidate_lineage)?record.candidate_lineage:[])]:[record];
    return identities.some(identity=>(!report||String(identity.report_id??'').toUpperCase()===report)&&(!batch||identity.batch_id===batch))&&
      (name?normalize(record.shelter_name)===name:report);
  });
  if(candidates.length!==1)throw new CorrectionTargetError(candidates.length?'ambiguous':'missing','Target koreksi hilang atau ambigu. Pilih satu posko dengan nama dan ID laporan yang sesuai rekap.');
  return JSON.stringify({report_text:text,correction_target:{snapshot_id:readback.snapshot_id,snapshot_sha256:readback.snapshot_sha256,record_index:candidates[0].index}});
}
