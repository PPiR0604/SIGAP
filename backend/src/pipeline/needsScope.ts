import { parseGapResult } from './toolResults.js';

export type SnapshotScope = { snapshot_id:string; snapshot_sha256:string; records:any[]; kind:'stored'|'candidate' };
export function isAllNeedsRequest(text:string):boolean {
  if (/^\s*(?:kenapa|mengapa|jangan|tidak\s+(?:perlu|usah))\b/i.test(text)||/\b(?:buletin|bulletin)\b/i.test(text)) return false;
  return /\b(?:semua|semuanya|seluruh|seluruhnya|keseluruhan|setiap|tiap)\b/i.test(text) && /\b(?:kebutuhan|kekurangan|butuh|gap|logistik|stok)\b/i.test(text);
}
export const storedNeedsOnly=(text:string)=>/\btersimpan\b/i.test(text)&&!/\b(?:kandidat|pratinjau|belum\s+(?:tersimpan|disimpan))\b/i.test(text);
const norm=(value:unknown)=>String(value??'').trim().toLowerCase().replace(/\s+/g,' ');
const key=(record:any)=>JSON.stringify([norm(record.shelter_name),norm(record.village)]);

/** Each calculation remains in Langflow; this only combines its verified per-shelter results. */
export async function calculateAllNeeds(scopes:SnapshotScope[], call:(reference:{snapshot_id:string;snapshot_sha256:string})=>Promise<string>) {
  const active=new Map<string,{record:any;result:any}>();
  for(const scope of scopes){
    const calculated=parseGapResult(await call({snapshot_id:scope.snapshot_id,snapshot_sha256:scope.snapshot_sha256}));
    if(calculated.snapshot_id!==scope.snapshot_id||calculated.snapshot_sha256!==scope.snapshot_sha256)throw new Error('Hasil hitung tidak mengacu snapshot yang diminta.');
    if(calculated.shelters.length!==scope.records.length)throw new Error('Hasil hitung tidak mencakup seluruh posko sumber.');
    const seen=new Set<string>();
    for(const record of scope.records){
      const identity=key(record);
      if(!record.shelter_name||seen.has(identity))throw new Error('Identitas posko pada sumber kosong atau ambigu.');
      seen.add(identity);
      const matches=calculated.shelters.filter(row=>key(row)===identity);
      if(matches.length!==1)throw new Error('Posko sumber tidak cocok dengan hasil kalkulasi.');
      if(record.update_target){
        const targets=[...active.entries()].filter(([,entry])=>entry.record.batch_id===record.update_target.batch_id&&entry.record.report_id===record.update_target.report_id);
        if(targets.length>1)throw new Error('Target koreksi pada seluruh rekap ambigu.');
        if(targets.length===1)active.delete(targets[0][0]);
      }
      active.set(identity,{record,result:matches[0]});
    }
  }
  const shelters=[...active.values()].map(entry=>entry.result);
  if(!shelters.length)throw new Error('Tidak ada posko untuk dihitung.');
  const sum=(values:(number|null|undefined)[])=>{
    const known=values.filter((value):value is number=>typeof value==='number'&&Number.isFinite(value));
    return known.length?known.reduce((total,value)=>total+value,0):null;
  };
  return {shelters,totals:{total_people:sum(shelters.map(row=>row.total_people)),air_liter_per_hari:sum(shelters.map(row=>row.needs?.air_liter_per_hari?.value)),kkal_per_hari:sum(shelters.map(row=>row.needs?.kkal_per_hari?.value))},
    partial:shelters.some(row=>row.total_people==null),scope:'all_shelters',pending_candidates:scopes.some(scope=>scope.kind==='candidate'),snapshot_refs:scopes.map(({snapshot_id,snapshot_sha256,kind})=>({snapshot_id,snapshot_sha256,kind}))};
}

export function renderAllNeeds(result:Awaited<ReturnType<typeof calculateAllNeeds>>):string {
  const cell=(value:unknown)=>String(value??'Belum diketahui').replace(/\|/g,'\\|').replace(/[\r\n]+/g,' ');
  const number=(value:unknown)=>typeof value==='number'?new Intl.NumberFormat('id-ID').format(value):'Belum diketahui';
  const lines=[`**Kebutuhan seluruh rekap — ${result.shelters.length} posko.**`,result.pending_candidates?'Mencakup rekap tersimpan dan kandidat terbaru yang belum disimpan.':'Berdasarkan seluruh rekap tersimpan.', '',
    '| Posko | Desa | Air (L/hari) | Pangan (kkal/hari) | Jamban | Hunian (m²) | Gap air (L/hari) |', '| --- | --- | ---: | ---: | ---: | ---: | ---: |'];
  for(const row of result.shelters)lines.push(`| ${cell(row.shelter_name)} | ${cell(row.village)} | ${number(row.needs.air_liter_per_hari?.value)} | ${number(row.needs.kkal_per_hari?.value)} | ${number(row.needs.jamban_unit?.value)} | ${number(row.needs.ruang_hunian_m2?.value)} | ${number(row.gaps.air_liter_per_hari)} |`);
  lines.push('', 'Angka dihitung Langflow dari snapshot sumber. Gap tetap belum diketahui bila stok/periode belum lengkap. Tidak ada penyimpanan atau distribusi otomatis.');
  return lines.join('\n');
}
