const columns:Record<string,string>={waktu_laporan:'reported_at',id_laporan:'report_id',posko:'shelter_name',desa:'village',jenis_pengungsian:'shelter_type',jumlah_jiwa:'total_people',jumlah_kk:'total_families',laki_laki:'male',perempuan:'female',bayi_balita:'infants_toddlers',anak:'children',lansia:'elderly',ibu_hamil:'pregnant',ibu_menyusui:'breastfeeding',disabilitas:'disability',kebutuhan_mendesak:'urgent_needs',sudah_cukup:'surplus_do_not_send',catatan:'notes',stok_json:'stock',konteks_stok_json:'stock_context',provenance_json:'field_provenance',sumber_laporan_json:'source_report_ids',masalah_validasi_json:'validation_issues',angka_tidak_terverifikasi_json:'unverified_numbers',field_kosong_json:'missing_fields',masalah_stok_json:'stock_issues',riwayat_catatan_json:'notes_history',riwayat_koreksi_json:'corrections',usulan_clear_json:'pending_clear_fields',estimasi:'is_estimate',status_validasi:'validation_status'};
const counts=new Set(['total_people','total_families','male','female','infants_toddlers','children','elderly','pregnant','breastfeeding','disability']);
export function storageRecords(document:any){
 if(!Array.isArray(document?.header)||!Array.isArray(document?.rows))throw new Error('Format rekap tidak valid.');
 return document.rows.map((row:any[])=>Object.fromEntries(document.header.map((column:string,i:number)=>{
  const key=columns[column]||column;let value=row[i]??null;
  if(counts.has(key)){const n=Number(value);value=value===null||value===''||!Number.isSafeInteger(n)||n<0?null:n;}
  else if(column.endsWith('_json')){try{value=typeof value==='string'?JSON.parse(value||(['stock','stock_context','field_provenance'].includes(key)?'{}':'[]')):value;}catch{throw new Error('Metadata rekap tidak valid.');}}
  else if(['urgent_needs','surplus_do_not_send'].includes(key))value=typeof value==='string'?value.split(';').map(v=>v.trim()).filter(Boolean):value||[];
  else if(key==='is_estimate')value=value===true||value==='true'?true:value===false||value==='false'?false:null;
  else if(key==='reported_at'){
   const m=/^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/.exec(String(value||''));
   value=m?`${m[1]}T${m[2].padStart(2,'0')}:${m[3]}${m[4]==='Z'?'+00:00':m[4]||''}`:null;
  }
  return [key,value];
 })));
}
