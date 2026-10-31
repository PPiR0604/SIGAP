export type ReviewKind='missing'|'clarification'|'decision'|'stock';
export type ReviewItem={kind:ReviewKind;field:string;text:string};
const labels:Record<string,string>={shelter_name:'Nama posko',village:'Desa',reported_at:'Waktu laporan',total_people:'Jumlah jiwa',total_families:'Jumlah KK',male:'Laki-laki',female:'Perempuan',infants_toddlers:'Bayi/balita',children:'Anak',elderly:'Lansia',pregnant:'Ibu hamil',breastfeeding:'Ibu menyusui',disability:'Disabilitas',urgent_needs:'Kebutuhan posko',notes:'Catatan',stock:'Stok',stock_context:'Periode stok'};
const counts=['total_families','male','female','infants_toddlers','children','elderly','pregnant','breastfeeding','disability'];
const stockMetrics:Record<string,string>={air_liter_per_hari:'Air bersih',kkal_per_hari:'Pangan',jamban_unit:'Jamban',ruang_hunian_m2:'Ruang hunian'};
export const reviewFieldLabel=(field:string)=>labels[field]||'Data laporan';
const empty=(value:unknown)=>value===null||value===undefined||value==='';

/** Explain evidence already supplied by the server. Zero remains a known value. */
export function reviewIndicators(record:Record<string,any>):ReviewItem[]{
  const items:ReviewItem[]=[];
  const add=(kind:ReviewKind,field:string,text:string)=>{if(!items.some(i=>i.kind===kind&&i.field===field&&i.text===text))items.push({kind,field,text});};
  const missing=new Set<string>((record.missing_fields||[]).filter((v:unknown)=>typeof v==='string'));
  for(const field of ['shelter_name','village','total_people'])if(empty(record[field]))missing.add(field);
  for(const field of counts)if(Object.hasOwn(record,field)&&empty(record[field]))missing.add(field);
  if(Object.hasOwn(record,'reported_at')&&empty(record.reported_at))missing.add('reported_at');
  if(Object.hasOwn(record,'urgent_needs')&&!record.urgent_needs?.length)missing.add('urgent_needs');
  for(const field of missing){
    if(!empty(record[field])&&!Array.isArray(record[field]))continue;
    add('missing',field,`${reviewFieldLabel(field)} belum dilaporkan.`);
  }
  for(const issue of record.validation_issues||[]){
    if(issue?.field==='storage_conflicts')continue;
    const field=typeof issue?.field==='string'?issue.field:'validation';
    const reason=typeof issue==='string'?issue:issue?.reason||issue?.detail;
    if(reason)add('clarification',field,field==='male+female'?`Rincian laki-laki dan perempuan: ${reason}`:`${reviewFieldLabel(field)}: ${reason}`);
  }
  if(['male','female','total_people'].every(k=>typeof record[k]==='number')&&record.male+record.female!==record.total_people&&!items.some(i=>i.field==='male+female'))add('clarification','male+female',`${record.male} laki-laki + ${record.female} perempuan = ${record.male+record.female}, berbeda dari jumlah jiwa ${record.total_people}.`);
  for(const issue of record.unverified_numbers||[])add('clarification',issue.field||'unverified',`${reviewFieldLabel(issue.field||'')}: angka belum terverifikasi dari sumber laporan.`);
  for(const field of record.storage_issues||[])add('clarification',String(field),`${reviewFieldLabel(String(field))}: format data tersimpan perlu diperiksa.`);
  for(const issue of record.stock_issues||[]){
    const text=typeof issue==='string'?issue:issue.reason||issue.detail||'Data stok perlu diperiksa.';
    add('clarification','stock',text.startsWith('Key stok tidak dikenal:')?'Ada jenis stok yang belum dikenali. Klarifikasi nama barang, jumlah, dan satuannya.':text);
  }
  for(const c of record.storage_conflicts||[])add('decision',c.field,`${reviewFieldLabel(c.field)} berbeda dengan rekap tersimpan. Pilih nilai lama atau baru sebelum menyimpan.`);
  for(const field of record.pending_clear_fields||[])add('decision',field,`Putuskan usulan pengosongan ${reviewFieldLabel(field).toLowerCase()}.`);
  if(Object.hasOwn(record,'stock')){
    for(const [key,label] of Object.entries(stockMetrics)){
      const value=record.stock?.[key],context=record.stock_context?.[key];
      if(empty(value)){add('stock',key,`Stok ${label.toLowerCase()} belum dilaporkan; kekurangan belum dapat dipastikan.`);continue;}
      if(!context?.recorded_at)add('stock',key,`Waktu pencatatan stok ${label.toLowerCase()} belum diketahui.`);
      if(key==='air_liter_per_hari'||key==='kkal_per_hari'){
        if(empty(context?.horizon_hours))add('stock',key,`Periode stok ${label.toLowerCase()} belum diketahui.`);
        else if(context.horizon_hours!==24)add('stock',key,`Stok ${label.toLowerCase()} memakai periode ${context.horizon_hours} jam; perlu diperiksa terhadap acuan kebutuhan 24 jam.`);
      }
    }
  }
  return items;
}

export function reviewSummary(items:ReviewItem[]=[]):string{
  const counts={clarification:0,decision:0,missing:0,stock:0};
  for(const item of items)counts[item.kind]++;
  return [counts.clarification?'Perlu klarifikasi':'',counts.decision?'Perlu keputusan':'',counts.missing?`${counts.missing} data belum dilaporkan`:'',counts.stock?`${counts.stock} catatan stok`:''].filter(Boolean).join(' · ');
}
