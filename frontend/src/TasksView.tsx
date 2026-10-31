import type {CSSProperties} from 'react';
import type {Shelter} from './demo';
import type {PendingReview} from './pendingReviews';
import {populationCoverage,tasksFor,qualityLabel} from './presentation';
export function TasksView({rows,reviews,busy,onOpen,onReport,headingRef}:{rows:Shelter[];reviews:PendingReview[];busy:boolean;onOpen:(s:Shelter,action:string)=>void;onReport:()=>void;headingRef:React.RefObject<HTMLHeadingElement|null>}){
 const tasks=tasksFor(rows,reviews);
 return <div className="tasks-view"><div className="heading-row"><div><h1 ref={headingRef} tabIndex={-1}>Tugas petugas</h1><p>{populationCoverage(rows)}</p></div><button className="button primary" onClick={onReport}>Masukkan laporan</button></div><p className="note">Urutan berdasarkan pemeriksaan data, bukan tingkat kedaruratan bencana.</p>
 {!tasks.length?<section className="card tasks-empty-card"><h2>{rows.length?'Tidak ada tugas pemeriksaan':'Belum ada laporan'}</h2><p>{rows.length?'Data yang diterima tidak memiliki catatan pemeriksaan atau perubahan menunggu.':'Masukkan laporan atau baca rekap tersimpan dari halaman Laporan.'}</p></section>:<div className="task-grid">{tasks.map((t,idx)=><section className="card task-card" style={{'--card-index':idx} as CSSProperties} key={JSON.stringify([t.shelter.sourceBatchId,t.shelter.id])}><header><h2>{t.shelter.name}</h2><span className="badge neutral">{qualityLabel(t.shelter)}</span></header><p className="muted">{t.shelter.village}</p><strong>{t.summary}</strong><p>{t.count} catatan · {t.pending?'Perubahan belum disimpan':'Tanpa perubahan menunggu'}</p><button className="button secondary" disabled={busy} onClick={()=>onOpen(t.shelter,t.action)}>{t.action}</button></section>)}</div>}
 </div>;
}
