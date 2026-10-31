import {useState} from 'react';
import {ChevronRight,ClipboardCheck} from 'lucide-react';
import type {Shelter} from './demo';
import {shelterKey} from './chartData';
import {reviewSummary} from './reviewIndicators';

const statuses=[
  {label:'Perlu klarifikasi',color:'#d97706'},
  {label:'Parsial',color:'#64748b'},
  {label:'Menunggu persetujuan',color:'#2563eb'},
  {label:'Siap ditinjau',color:'#059669'},
] as const;
type StatusFilter='review'|'all'|Shelter['status'];

export function StatusOverview({shelters,onSelect}:{shelters:Shelter[];onSelect:(s:Shelter)=>void}){
  const [filter,setFilter]=useState<StatusFilter>('review'),[page,setPage]=useState(0);
  const counts=statuses.map(status=>({...status,count:shelters.filter(s=>s.status===status.label).length}));
  const needsReview=shelters.filter(s=>s.status!=='Siap ditinjau').length;
  const rows=shelters.filter(s=>filter==='all'||(filter==='review'?s.status!=='Siap ditinjau':s.status===filter));
  const pageSize=4,pages=Math.max(1,Math.ceil(rows.length/pageSize)),currentPage=Math.min(page,pages-1);
  let cursor=0;
  const segments=counts.map(status=>{const start=cursor;cursor+=shelters.length?status.count/shelters.length*100:0;return `${status.color} ${start}% ${cursor}%`;});
  const selectFilter=(next:StatusFilter)=>{setFilter(next);setPage(0);};
  return <section className="status-overview" aria-label="Status Pemeriksaan Posko">
    <header className="status-overview-heading"><span className="status-overview-icon"><ClipboardCheck size={21} aria-hidden="true"/></span><div><h3>Status Pemeriksaan Posko</h3><p>Pantau laporan dan buka posko yang perlu ditinjau.</p></div></header>
    <div className="status-chart-layout">
      <div className="status-donut" role="img" aria-label={shelters.length?`Sebaran status ${shelters.length} posko: ${counts.map(s=>`${s.label} ${s.count}`).join(', ')}`:'Belum ada data status posko'} style={{background:shelters.length?`conic-gradient(${segments.join(',')})`:'var(--neutral-bg)'}}><div aria-hidden="true"><strong>{shelters.length}</strong><span>posko terdata</span></div></div>
      <ul className="status-chart-legend" aria-label="Jumlah posko per status">{counts.map(status=><li key={status.label}><button type="button" aria-pressed={filter===status.label} aria-label={`${status.label}: ${status.count} posko`} onClick={()=>selectFilter(status.label)}><span className="status-legend-label"><i aria-hidden="true" style={{background:status.color}}/>{status.label}</span><span className="status-legend-value"><strong>{status.count}</strong><small>{shelters.length?`${(status.count/shelters.length*100).toLocaleString('id-ID',{maximumFractionDigits:1})}%`:'—'}</small></span></button></li>)}</ul>
    </div>
    <p className="status-review-summary"><strong>{needsReview} dari {shelters.length} posko</strong> perlu pemeriksaan data.</p>
    <div className="status-list-filters" role="group" aria-label="Daftar status posko"><button type="button" aria-pressed={filter==='review'} onClick={()=>selectFilter('review')}>Perlu ditinjau ({needsReview})</button><button type="button" aria-pressed={filter==='all'} onClick={()=>selectFilter('all')}>Semua posko ({shelters.length})</button></div>
    <p className="status-list-caption">{filter==='all'?'Semua posko dalam rekap':filter==='review'?'Posko yang perlu pemeriksaan':`Posko dengan status ${filter.toLowerCase()}`}</p>
    {!rows.length&&<p className="status-list-empty">{!shelters.length?'Belum ada posko dalam rekap.':filter==='review'?'Tidak ada posko yang memerlukan pemeriksaan pada rekap ini.':'Tidak ada posko pada status ini.'}</p>}
    <ul className="status-shelter-list" aria-label="Daftar posko berdasarkan status">{rows.slice(currentPage*pageSize,(currentPage+1)*pageSize).map(s=><li key={shelterKey(s)}><button type="button" onClick={()=>onSelect(s)} aria-label={`Periksa posko ${s.name}, ${s.village}`}><div><strong>{s.name}</strong><span>{s.village}</span><span className="status-row-state">{s.status}</span><p>{reviewSummary(s.reviewItems)||s.note}</p></div><ChevronRight size={18} aria-hidden="true"/></button></li>)}</ul>
    {pages>1&&<div className="status-pagination"><span aria-live="polite">Halaman {currentPage+1} dari {pages}</span><div role="group" aria-label="Halaman daftar status posko"><button className="button secondary" disabled={currentPage===0} onClick={()=>setPage(currentPage-1)}>Sebelumnya</button><button className="button secondary" disabled={currentPage===pages-1} onClick={()=>setPage(currentPage+1)}>Berikutnya</button></div></div>}
    <p className="status-overview-note">Status menunjukkan pemeriksaan data, bukan tingkat kedaruratan. Klik status untuk menyaring daftar.</p>
  </section>;
}
