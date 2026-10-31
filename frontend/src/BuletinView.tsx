import {useEffect,useRef,useState} from 'react';
import {Check,ClipboardCheck,Database,FileText,TriangleAlert} from 'lucide-react';
import {hasBulletinContent} from './bulletin';
import {populationCoverage,qualityLabel} from './presentation';
import type {BulletinSource} from './useBulletinSource';
import {BulletinActionsCard,DonationPriorityCard,SnapshotMetadataCard} from './DonationPriority';
import {OfficialPaper} from './OfficialPaper';
import {PublicationApproval} from './PublicationApproval';
import {PublicationLinks} from './PublicationLinks';

export function BuletinView({content,batchId,source,sourceChanged,role,processing,dispatching,stage,canRequest,onCopy,onRequest,onGoLaporan,headingRef,contextId}:{
 contextId:string;content:string;batchId:string;source:BulletinSource|null;sourceChanged:boolean;role:'admin'|'petugas';processing:boolean;dispatching:boolean;stage:string;canRequest:boolean;onCopy:()=>void;onRequest:()=>void;onGoLaporan:()=>void;headingRef:React.RefObject<HTMLHeadingElement|null>;
}){
 useEffect(()=>{headingRef.current?.focus();},[headingRef]);
 const hasDraft=hasBulletinContent(content),rows=source?.rows||[],hasSource=!!source?.snapshotId;
 const identity=JSON.stringify([batchId,content]);
 const [publishedIdentity,setPublishedIdentity]=useState('');
 const [publicationRevision,setPublicationRevision]=useState(0);
 const published=publishedIdentity===identity;
 const actionHeading=useRef<HTMLHeadingElement>(null);
 const estimated=rows.filter(s=>s.estimate).length,needsReview=rows.filter(s=>qualityLabel(s)!=='Siap diperiksa').length;
 const generated=source?.generatedAt&&Number.isFinite(Date.parse(source.generatedAt))?new Date(source.generatedAt).toLocaleString('id-ID'):null;
 const steps=[
  {title:'Sumber',text:hasSource?`${rows.length} posko pada sumber draf`:'Belum terikat ke draf',icon:Database},
  {title:'Draf',text:hasDraft?'Tersedia untuk dibaca':processing?'Sedang diproses':'Susun dari rekap',icon:FileText},
  {title:'Publikasi',text:published?'Disetujui admin':hasDraft?'Perlu tinjauan admin':'Setelah draf tersedia',icon:ClipboardCheck},
 ];
 const current=published?-1:hasDraft?2:hasSource?1:0;
 return <div className="bulletin-workspace">
  <div className="page-heading heading-row"><div><p className="location">INFORMASI UNTUK MITRA &amp; DONATUR</p><h1 ref={headingRef} tabIndex={-1}>Draf Buletin Kebutuhan Logistik</h1><p>Periksa sumber dan isi, lalu ajukan untuk publikasi.</p></div><div className="bulletin-header-compose"><span className={`badge ${published?'success':'neutral'}`}>{published?'Publikasi disetujui':hasDraft?'Draf kerja':'Belum ada draf'}</span>{!hasDraft&&<><button type="button" className="button primary" disabled={!canRequest||processing||dispatching} onClick={onRequest}><FileText size={16} aria-hidden="true"/>Susun draf</button>{!canRequest&&<small>Hubungkan backend dari halaman Laporan.</small>}</>}</div></div>
  <ol className="bulletin-workflow" aria-label="Alur buletin">{steps.map((s,i)=><li key={s.title} aria-current={i===current?'step':undefined}><span className="bulletin-workflow-icon">{(i===0?hasSource:i===1?hasDraft:published)?<Check size={18} aria-hidden="true"/>:<s.icon size={18} aria-hidden="true"/>}</span><div><strong>{i+1}. {s.title}</strong><span>{s.text}</span></div></li>)}</ol>
  <section className="bulletin-source-summary" aria-label="Sumber dan cakupan buletin"><div className="bulletin-section-title"><div><span className="result-eyebrow">1. Sumber yang digunakan</span><h2>{source?.contextName||'Sumber buletin'}</h2></div><span className="source-kind">{!hasSource?'Referensi belum tersedia':source?.stored?'Rekap tersimpan':'Kandidat pemeriksaan'}</span></div>
   {hasSource?<><dl className="bulletin-source-facts"><div><dt>Cakupan posko</dt><dd>{rows.length} posko</dd></div><div><dt>Populasi</dt><dd>{populationCoverage(rows)}</dd></div><div><dt>Disusun</dt><dd>{generated||'Waktu belum tersedia'}</dd></div></dl>{(estimated>0||needsReview>0)&&<p className="bulletin-source-limits">{[estimated?`${estimated} posko memakai estimasi`:'',needsReview?`${needsReview} posko masih memiliki catatan pemeriksaan`:''].filter(Boolean).join(' · ')}. Pertahankan batas data ini dalam buletin.</p>}</>:<p className="source-unavailable">{hasDraft?'Referensi sumber draf belum tersedia. Periksa isi dan sumber laporan sebelum digunakan.':'Sumber akan tercatat saat draf disusun. Mulai dengan Susun draf.'}</p>}
   <SnapshotMetadataCard shelters={rows} snapshotId={source?.snapshotId} storageVerified={source?.stored||false} contextName={source?.contextName}/>
  </section>
  {sourceChanged&&<div className="bulletin-source-changed" role="status"><TriangleAlert size={19} aria-hidden="true"/><div><strong>Data sumber berubah; susun ulang untuk memakai data terbaru.</strong><p>Draf yang sedang dibaca tetap memakai sumber saat dibuat.</p></div><button type="button" className="button secondary" onClick={()=>{actionHeading.current?.focus();actionHeading.current?.scrollIntoView({block:'center',behavior:'auto'});}}>Lihat aksi pembaruan</button></div>}
  <div className="bulletin-grid-layout bulletin-reading-layout">
   <section className="bulletin-main-column" aria-label="Baca draf buletin"><div className="bulletin-reading-heading"><div><span className="result-eyebrow">2. Baca draf</span><h2>Isi buletin</h2></div><span>{hasDraft?'Periksa angka, estimasi, dan kebutuhan.':'Dokumen akan muncul di sini.'}</span></div><OfficialPaper bulletinText={content} sourceRecords={source?.records} snapshotId={source?.snapshotId} processing={processing} dispatching={dispatching} stageLabelText={stage} onGoLaporan={onGoLaporan} contextName={source?.contextName} published={published}/>
    {rows.length>0&&<details className="bulletin-needs-disclosure"><summary>Kebutuhan dari sumber draf</summary><DonationPriorityCard shelters={rows}/></details>}
   </section>
   <aside className="bulletin-side-column" aria-label="Informasi & Aksi Buletin"><section className="bulletin-review-panel"><span className="result-eyebrow">3. Periksa &amp; publikasikan</span><h2 ref={actionHeading} tabIndex={-1}>Tindakan berikutnya</h2><BulletinActionsCard hasDraft={hasDraft} onCopy={onCopy} onRequestBulletin={onRequest} processing={processing} dispatching={dispatching} canRequest={canRequest} sourceChanged={sourceChanged} composeInHeader/>
    {hasDraft&&<details className="bulletin-review-guide"><summary>Apa yang perlu diperiksa?</summary><ul><li>Angka dan posko sesuai dengan sumber.</li><li>Estimasi serta data yang belum lengkap tetap disebut.</li><li>Acuan kebutuhan dan kekurangan stok dibedakan.</li></ul></details>}
    {role==='admin'&&hasDraft?<PublicationApproval content={content} batchId={batchId} busy={processing||dispatching} revision={publicationRevision} onLinkChanged={()=>setPublicationRevision(n=>n+1)} onPublished={()=>setPublishedIdentity(identity)}/>:<div className="bulletin-admin-note"><ClipboardCheck size={18} aria-hidden="true"/><div><strong>Publikasi oleh admin</strong><p>{hasDraft?'Admin meninjau isi dan data sebelum membuat tautan publik.':'Susun draf terlebih dahulu, lalu admin dapat meninjaunya.'}</p></div></div>}
    {role==='admin'&&<PublicationLinks contextId={contextId} revision={publicationRevision} onChanged={()=>setPublicationRevision(n=>n+1)}/>}
   </section></aside>
  </div>
 </div>;
}
