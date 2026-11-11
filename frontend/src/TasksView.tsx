import {ActionButton} from './ui/ActionButton';
import type {CSSProperties} from 'react';
import {Chip} from '@/components/base/badges/chip';
import type {Shelter} from './demo';
import type {PendingReview} from './pendingReviews';
import {populationCoverage,tasksFor,qualityLabel} from './presentation';
export function TasksView({rows,reviews,busy,onOpen,onReport,headingRef}:{rows:Shelter[];reviews:PendingReview[];busy:boolean;onOpen:(s:Shelter,action:string)=>void;onReport:()=>void;headingRef:React.RefObject<HTMLHeadingElement|null>}){
 const tasks=tasksFor(rows,reviews);
 return <div className="tasks-view"><div className="heading-row"><div><h1 ref={headingRef} tabIndex={-1}>Tugas petugas</h1><p>{populationCoverage(rows)}</p></div><ActionButton className="button primary" onClick={onReport}>Masukkan laporan</ActionButton></div><p className="note">Urutan berdasarkan pemeriksaan data, bukan tingkat kedaruratan bencana.</p>
 {!tasks.length?<section className="card tasks-empty-card"><h2>{rows.length?'Tidak ada tugas pemeriksaan':'Belum ada laporan'}</h2><p>{rows.length?'Data yang diterima tidak memiliki catatan pemeriksaan atau perubahan menunggu.':'Masukkan laporan atau baca rekap tersimpan dari halaman Laporan.'}</p></section>:<div className="task-grid">{tasks.map((t,idx)=><section className="card task-card" style={{'--card-index':idx} as CSSProperties} key={JSON.stringify([t.shelter.sourceBatchId,t.shelter.id])}><header><h2>{t.shelter.name}</h2><Chip color="soft" variant="caption">{qualityLabel(t.shelter)}</Chip></header><p className="muted">{t.shelter.village}</p><strong>{t.summary}</strong><p>{t.count} catatan · {t.pending?'Perubahan belum disimpan':'Tanpa perubahan menunggu'}</p><ActionButton className="button secondary" disabled={busy} onClick={()=>onOpen(t.shelter,t.action)}>{t.action}</ActionButton></section>)}</div>}
 </div>;
}
