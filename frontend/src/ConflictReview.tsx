import type {Preview} from './backendPreview';
export type ConflictChoices=Record<string,Record<string,'keep'|'incoming'>>;
export const storageConflicts=(preview:Preview|null)=>(preview?.records||[]).flatMap(record=>(record.storage_conflicts||[]).map((conflict:any)=>({...conflict,reportId:record.report_id,name:record.shelter_name})));
const labels:Record<string,string>={total_people:'Jumlah jiwa',male:'Laki-laki',female:'Perempuan',elderly:'Lansia',disability:'Disabilitas',urgent_needs:'Kebutuhan',stock:'Stok',stock_context:'Periode stok',notes:'Catatan'};
const value=(data:unknown)=>typeof data==='string'?data:JSON.stringify(data);
export function ConflictReview({preview,choices,onChange}:{preview:Preview|null;choices:ConflictChoices;onChange:(choices:ConflictChoices)=>void}){
  const conflicts=storageConflicts(preview);
  if(!conflicts.length)return null;
  return <section aria-label="Konflik dengan rekap tersimpan"><h3>Pilih nilai untuk setiap konflik</h3><p>Laporan berbeda dari rekap tersimpan. Periksa waktu dan sumber sebelum memilih. Pilihan belum disimpan.</p>
    {conflicts.map((conflict:any)=><div className="detail-note" key={`${conflict.reportId}:${conflict.field}`}><div><strong>{conflict.name} · {labels[conflict.field]||conflict.field}</strong>
      <p>Tersimpan: {value(conflict.previous_value)} · {conflict.previous_reported_at||'Waktu belum diketahui'}</p>
      <p>Laporan baru: {value(conflict.incoming_value)} · {conflict.incoming_reported_at||'Waktu belum diketahui'}</p>
      {conflict.incoming_provenance?.source_excerpt&&<blockquote>{conflict.incoming_provenance.source_excerpt}</blockquote>}
      <label className="field-label">Keputusan {conflict.reportId} {conflict.field}<select aria-label={`Konflik ${conflict.reportId} ${conflict.field}`} value={choices[conflict.reportId]?.[conflict.field]||''} onChange={event=>onChange({...choices,[conflict.reportId]:{...choices[conflict.reportId],[conflict.field]:event.target.value as 'keep'|'incoming'}})}><option value="">Pilih nilai</option><option value="keep">Pertahankan nilai tersimpan</option><option value="incoming">Gunakan nilai laporan baru</option></select></label>
    </div></div>)}
  </section>;
}
