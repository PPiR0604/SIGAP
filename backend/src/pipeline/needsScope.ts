import { parseGapResult } from './toolResults.js';

export type SnapshotScope = { snapshot_id:string; snapshot_sha256:string; records:any[]; kind:'stored'|'candidate' };
const norm=(value:unknown)=>String(value??'').trim().toLowerCase().replace(/\s+/g,' ');
const key=(record:any)=>JSON.stringify([norm(record.shelter_name),norm(record.village)]);
const olderReport=(record:any,current:any)=>{
  if(record.shelter_id&&current.shelter_id&&record.shelter_id!==current.shelter_id)return false;
  const stamp=(v:any)=>typeof v==='string'?v.replace('T',' ').slice(0,16):'';
  const before=stamp(record.reported_at),after=stamp(current.reported_at);
  return !!before&&!!after&&before<after;
};

/** Each calculation remains in Langflow; this only combines its verified per-shelter results. */
export async function calculateAllNeeds(scopes:SnapshotScope[], call:(reference:{snapshot_id:string;snapshot_sha256:string})=>Promise<string>) {
  const active=new Map<string,{record:any;result:any;kind:SnapshotScope['kind']}>();
  const used:SnapshotScope[]=[];
  for(const scope of scopes){
    const relevant=scope.records.filter(record=>!active.has(key(record))||!olderReport(record,active.get(key(record))!.record));
    if(!relevant.length)continue;
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
      if((matches[0].total_people??null)!==(record.total_people??null))throw new Error('Jumlah jiwa hasil kalkulasi tidak sesuai sumber snapshot.');
      if(!relevant.includes(record))continue;
      if(record.update_target){
        const targets=[...active.entries()].filter(([,entry])=>entry.record.batch_id===record.update_target.batch_id&&entry.record.report_id===record.update_target.report_id);
        if(targets.length>1)throw new Error('Target koreksi pada seluruh rekap ambigu.');
        if(targets.length===1)active.delete(targets[0][0]);
      }
      active.set(identity,{record,result:matches[0],kind:scope.kind});
    }
    used.push(scope);
  }
  const shelters=[...active.values()].map(entry=>entry.result);
  if(!shelters.length)throw new Error('Tidak ada posko untuk dihitung.');
  const sum=(values:(number|null|undefined)[])=>{
    const known=values.filter((value):value is number=>typeof value==='number'&&Number.isFinite(value));
    return known.length?known.reduce((total,value)=>total+value,0):null;
  };
  return {shelters,totals:{total_people:sum(shelters.map(row=>row.total_people)),air_liter_per_hari:sum(shelters.map(row=>row.needs?.air_liter_per_hari?.value)),kkal_per_hari:sum(shelters.map(row=>row.needs?.kkal_per_hari?.value))},
    partial:shelters.some(row=>row.total_people==null),scope:'all_shelters',pending_candidates:[...active.values()].some(entry=>entry.kind==='candidate'),snapshot_refs:used.map(({snapshot_id,snapshot_sha256,kind})=>({snapshot_id,snapshot_sha256,kind}))};
}

export function renderAllNeeds(result:Awaited<ReturnType<typeof calculateAllNeeds>>):string {
  const cell=(value:unknown)=>String(value??'Belum diketahui').replace(/\|/g,'\\|').replace(/[\r\n]+/g,' ');
  const number=(value:unknown)=>typeof value==='number'?new Intl.NumberFormat('id-ID').format(value):'Belum diketahui';
  const lines=[`**Kebutuhan seluruh rekap — ${result.shelters.length} posko.**`,result.pending_candidates?'Mencakup rekap tersimpan dan kandidat terbaru yang belum disimpan.':'Berdasarkan seluruh rekap tersimpan.',
    `Jumlah jiwa terdata: **${number(result.totals.total_people)}**. Kebutuhan air: **${number(result.totals.air_liter_per_hari)} L/24 jam**.${result.partial?' Total masih parsial karena jumlah jiwa sebagian posko belum diketahui.':''}`, '',
    '| Posko | Desa | Air (L/hari) | Pangan (kkal/hari) | Jamban | Hunian (m²) | Gap air (L/hari) |', '| --- | --- | ---: | ---: | ---: | ---: | ---: |'];
  for(const row of result.shelters)lines.push(`| ${cell(row.shelter_name)} | ${cell(row.village)} | ${number(row.needs.air_liter_per_hari?.value)} | ${number(row.needs.kkal_per_hari?.value)} | ${number(row.needs.jamban_unit?.value)} | ${number(row.needs.ruang_hunian_m2?.value)} | ${number(row.gaps.air_liter_per_hari)} |`);
  lines.push('', 'Angka dihitung Langflow dari snapshot sumber. Gap tetap belum diketahui bila stok/periode belum lengkap. Tidak ada penyimpanan atau distribusi otomatis.');
  return lines.join('\n');
}

export function renderWaterRanking(result:Awaited<ReturnType<typeof calculateAllNeeds>>):string {
  const metric='air_liter_per_hari';
  const number=(n:number)=>new Intl.NumberFormat('id-ID').format(n);
  const label=(row:any)=>[row.shelter_name,row.village].filter(Boolean).join(' — ').replace(/[\r\n|]/g,' ');
  const known=result.shelters.filter(row=>typeof row.gaps?.[metric]==='number'&&Number.isFinite(row.gaps[metric])&&row.gaps[metric]>=0)
    .sort((a,b)=>b.gaps[metric]-a.gaps[metric]||label(a).localeCompare(label(b),'id'));
  const unknown=result.shelters.filter(row=>!known.includes(row));
  const positive=known.filter(row=>row.gaps[metric]>0);
  const lines=[result.pending_candidates?'Berdasarkan rekap tersimpan dan kandidat terbaru yang belum disimpan.':'Berdasarkan seluruh rekap tersimpan.',''];
  if(positive.length){
    const max=positive[0].gaps[metric],leaders=positive.filter(row=>row.gaps[metric]===max);
    lines.push(`Kekurangan air terbesar yang dapat dihitung adalah **${number(max)} L/hari**, pada **${leaders.map(label).join('; ')}**.`, '',
      '| Posko — Desa | Kekurangan air (L/hari) |','| --- | ---: |');
    for(const row of positive)lines.push(`| ${label(row)}${row.is_estimate?' (estimasi)':''} | ${number(row.gaps[metric])} |`);
  }else lines.push(known.length?'Tidak ada kekurangan air positif pada posko yang gap-nya dapat dihitung.':'Belum bisa menentukan posko yang paling kekurangan air: belum ada gap air yang valid.');
  if(known.length>positive.length)lines.push('',`Gap air nol: ${known.filter(row=>row.gaps[metric]===0).map(label).join('; ')}.`);
  if(unknown.length)lines.push('',`**Belum dapat dibandingkan:** ${unknown.map(label).join('; ')}. Gap air belum diketahui; periksa kelengkapan dan validitas stok, waktu, serta periode stok. Data kosong tidak dianggap nol. Peringkat di atas hanya mencakup gap yang dapat dihitung.`);
  lines.push('','Angka mengikuti hasil kalkulator Langflow dan waktu data yang tercatat. Urutan berdasarkan kekurangan liter per hari, bukan skor prioritas umum. Keputusan distribusi tetap memerlukan penilaian petugas.');
  return lines.join('\n');
}

export function renderPriorityRanking(result:Awaited<ReturnType<typeof calculateAllNeeds>>):string {
  const cell=(value:unknown)=>String(value??'Belum diketahui').replace(/\|/g,'\\|').replace(/[\r\n]+/g,' ');
  const levels:Record<string,number>={TINGGI:0,SEDANG:1,RENDAH:2};
  const ranked=result.shelters.filter(row=>Object.hasOwn(levels,row.priority)&&typeof row.score==='number'&&Number.isFinite(row.score))
    .sort((a,b)=>levels[a.priority]-levels[b.priority]||b.score-a.score||cell(a.shelter_name).localeCompare(cell(b.shelter_name),'id'));
  const uncertain=result.shelters.filter(row=>!ranked.includes(row));
  const lines=[result.pending_candidates?'Berdasarkan rekap tersimpan dan kandidat terbaru yang belum disimpan.':'Berdasarkan seluruh rekap tersimpan.', '',
    '**Usulan prioritas pemeriksaan bantuan** berdasarkan skor umum kalkulator SIGAP; bukan peringkat khusus kekurangan air atau keputusan distribusi.'];
  if(ranked.length){
    lines.push('','| Posko | Desa | Prioritas | Skor | Alasan |','| --- | --- | --- | ---: | --- |');
    for(const row of ranked)lines.push(`| ${cell(row.shelter_name)}${row.is_estimate?' (estimasi)':''} | ${cell(row.village)} | ${cell(row.priority)} | ${row.score} | ${cell(row.reasons.join('; ')||'Tidak tersedia')} |`);
  }else lines.push('','Belum dapat menyusun peringkat: tidak ada posko dengan skor dan tingkat prioritas yang dapat dipastikan.');
  if(uncertain.length){
    lines.push('','**Perlu klarifikasi, tidak dimasukkan ke urutan:**');
    for(const row of uncertain)lines.push(`- ${cell(row.shelter_name)} — ${cell(row.village)} (${cell(row.priority)}): ${cell([...row.reasons,...row.issues].join('; ')||'Data belum cukup untuk memastikan prioritas.')}`);
  }
  lines.push('','Skor adalah heuristik SIGAP berdasarkan kebutuhan yang dilaporkan dan kelompok rentan. Data yang belum lengkap tidak berarti kebutuhan rendah. Tinjau waktu laporan dan kondisi lapangan; keputusan bantuan tetap pada petugas dan pimpinan pos komando.');
  return lines.join('\n');
}
