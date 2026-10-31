import {ArrowRight,CheckSquare,ClipboardCheck,TriangleAlert} from 'lucide-react';
import type {Shelter} from './demo';
import {changesFor} from './ChangeSummary';
import {matchesClarificationTarget} from './backendPreview';
import {qualityLabel} from './presentation';
import {reviewFieldLabel} from './reviewIndicators';

const fieldLabel=(field:string)=>({air_liter_per_hari:'Stok air',kkal_per_hari:'Stok pangan',jamban_unit:'Stok jamban',ruang_hunian_m2:'Luas hunian'} as Record<string,string>)[field]||reviewFieldLabel(field);
export function ReportResultSummary({shelter,savedRows,pending,storageLabel,busy,canApprove,onOpen,onApprove}:{
 shelter:Shelter;savedRows:Shelter[];pending:boolean;storageLabel:string;busy:boolean;canApprove:boolean;onOpen:()=>void;onApprove:()=>void;
}){
 const baseline=savedRows.filter(s=>matchesClarificationTarget(shelter,s));
 const changes=pending&&baseline.length===1?changesFor(baseline[0],shelter):[];
 const items=shelter.reviewItems||[];
 const conflict=items.some(i=>i.kind==='clarification'),decisions=items.filter(i=>i.kind==='decision');
 const missing=items.filter(i=>i.kind==='missing'||i.kind==='stock');
 const labels=[...new Set(missing.map(i=>fieldLabel(i.field)))];
 const mismatch=shelter.people!==null&&shelter.male!==null&&shelter.female!==null&&shelter.male+shelter.female!==shelter.people;
 const title=mismatch?`Rincian berbeda ${Math.abs(shelter.male!+shelter.female!-shelter.people!)} jiwa`:conflict?'Ada data yang perlu diklarifikasi':decisions.length?'Pilih data yang akan disimpan':pending?'Perubahan siap ditinjau':missing.length?'Data masih perlu dilengkapi':'Tidak ada catatan pemeriksaan';
 const Icon=conflict?TriangleAlert:ClipboardCheck;
 return <section className="report-result-summary" aria-label={`Hasil pemeriksaan ${shelter.name}`}>
  <header className="result-shelter-heading"><div><h3>{shelter.name}</h3><p>{shelter.village}</p></div><span className="result-quality">{qualityLabel(shelter)}</span></header>
  <dl className="result-key-facts"><div><dt>Jumlah jiwa{shelter.estimate?' · estimasi':''}</dt><dd>{shelter.people===null?'Belum diketahui':shelter.people.toLocaleString('id-ID')}</dd></div><div><dt>Penyimpanan</dt><dd>{storageLabel}</dd></div></dl>
  {pending&&<div className="result-change-block"><strong>{baseline.length===1?changes.length?`${changes.length} data berubah`:'Kandidat perlu ditinjau':'Laporan baru untuk ditinjau'}</strong>{changes.length>0&&<div className="result-change-table" role="region" aria-label={`Perubahan singkat ${shelter.name}`} tabIndex={0}><table><thead><tr><th scope="col">Data</th><th scope="col">Tersimpan</th><th scope="col">Usulan</th></tr></thead><tbody>{changes.slice(0,3).map(c=><tr key={c.label}><th scope="row">{c.label}</th><td>{c.before}</td><td>{c.after}</td></tr>)}</tbody></table></div>}{changes.length>3&&<p>{changes.length-3} perubahan lain tersedia saat meninjau persetujuan.</p>}{baseline.length!==1&&<p>Periksa seluruh data sebelum menyetujui.</p>}</div>}
  <div className={`result-conclusion${conflict?' needs-attention':''}`}><Icon size={18} aria-hidden="true"/><div><strong>{title}</strong>{mismatch&&<p>{shelter.male} laki-laki + {shelter.female} perempuan = {shelter.male!+shelter.female!}; total laporan {shelter.people}.</p>}{!mismatch&&conflict&&<p>Periksa angka dan kutipan sumber pada detail posko.</p>}{decisions.length>0&&<p>{decisions.length} keputusan lama/baru atau pengosongan menunggu tinjauan.</p>}{labels.length>0&&<p className="result-missing-fields">Lengkapi: {labels.slice(0,3).join(', ')}{labels.length>3?` +${labels.length-3} lainnya`:''}.</p>}{!items.length&&!pending&&<p>Anda tetap dapat membuka detail untuk memverifikasi data.</p>}</div></div>
  <div className="result-next-action"><span className="result-eyebrow">Langkah berikutnya</span>{pending&&!conflict?<><button className="button primary" disabled={busy||!canApprove} onClick={onApprove}><CheckSquare size={16} aria-hidden="true"/>Tinjau &amp; setujui</button><button className="button quiet" disabled={busy} onClick={onOpen}>Periksa &amp; klarifikasi {shelter.name}<ArrowRight size={15} aria-hidden="true"/></button></>:<><button className="button primary" disabled={busy} onClick={onOpen}>Periksa &amp; klarifikasi {shelter.name}<ArrowRight size={15} aria-hidden="true"/></button>{pending&&<button className="button secondary" disabled={busy||!canApprove} onClick={onApprove}>Tinjau &amp; setujui</button>}</>}{pending&&!canApprove&&!busy&&<p>Persetujuan kandidat ini sudah dikirim. Periksa hasil penyimpanannya.</p>}{!pending&&<p>Tidak ada perubahan menunggu persetujuan untuk posko ini.</p>}</div>
 </section>;
}
