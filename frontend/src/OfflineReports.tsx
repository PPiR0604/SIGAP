import {ActionButton} from './ui/ActionButton';
import {useEffect,useRef,useState} from 'react';
import {addReport,deleteReport,getReport,listReports,markPrepared,type QueuedReport} from './offlineQueue';
import {OfflineClassification} from './OfflineClassification';

export function OfflineReports({onPrepare,canPrepare=false}:{onPrepare?:(text:string,report:QueuedReport)=>boolean;canPrepare?:boolean}){
  const [reports,setReports]=useState<QueuedReport[]>([]),[draft,setDraft]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [busy,setBusy]=useState(false),[deleteId,setDeleteId]=useState<string|null>(null);
  const locked=useRef(false),draftRevision=useRef(0);
  const refresh=async()=>setReports(await listReports());
  useEffect(()=>{let active=true;const update=()=>{void listReports().then(items=>{if(active)setReports(items);}).catch(()=>{if(active)setError('Antrean perangkat tidak dapat dibuka. Periksa izin penyimpanan browser.');});};const channel=typeof BroadcastChannel==='undefined'?undefined:new BroadcastChannel('sigap-offline-updates');if(channel)channel.onmessage=update;window.addEventListener('focus',update);window.addEventListener('sigap-offline-changed',update);update();return()=>{active=false;channel?.close();window.removeEventListener('focus',update);window.removeEventListener('sigap-offline-changed',update);};},[]);
  function changed(){if(typeof BroadcastChannel!=='undefined'){const channel=new BroadcastChannel('sigap-offline-updates');channel.postMessage('changed');channel.close();}}
  async function operation(work:()=>Promise<void>){if(locked.current)return;locked.current=true;setBusy(true);setNotice('');try{await work();}finally{locked.current=false;setBusy(false);}}
  async function save(){await operation(async()=>{const revision=draftRevision.current;try{await addReport(draft);if(draftRevision.current===revision)setDraft('');changed();setError('');setNotice('Tersimpan di perangkat. Laporan belum diproses atau dikirim.');}catch(e){setError(e instanceof Error?e.message:'Laporan belum tersimpan. Periksa ruang penyimpanan perangkat.');return;}await refresh().catch(()=>setError('Laporan tersimpan, tetapi daftar belum dapat dimuat ulang.'));});}
  async function prepare(report:QueuedReport){if(!onPrepare||!canPrepare)return;await operation(async()=>{try{const current=await getReport(report.id);if(!current){await refresh();setError('Laporan sudah dihapus di tab lain. Tidak ada teks yang disalin.');return;}if(!onPrepare(current.text,current))return;await markPrepared(report.id);changed();await refresh();setError('');setNotice('Laporan disalin ke formulir. Periksa isinya dan tekan Kirim & Proses. Antrean masih tersimpan di perangkat.');}catch{setError('Status antrean belum tersimpan. Periksa formulir dan hindari pengiriman ganda.');}});}
  async function remove(id:string){await operation(async()=>{try{await deleteReport(id);changed();setDeleteId(null);await refresh();setError('');setNotice('Salinan laporan di perangkat dihapus.');}catch{setError('Laporan belum dapat dihapus dari perangkat.');}});}
  return <section className="offline-reports" aria-labelledby="offline-reports-title">
    <h2 id="offline-reports-title">Antrean laporan di perangkat</h2>
    <p>Laporan di sini belum dikirim atau diproses. Siapa pun yang memakai profil browser ini dapat membacanya. Hindari data pribadi; hapus salinan setelah tidak diperlukan.</p>
    <label htmlFor="offline-report-draft">Catat laporan</label>
    <textarea id="offline-report-draft" rows={4} value={draft} onChange={e=>{draftRevision.current++;setDraft(e.target.value);}} placeholder="Tulis atau tempel laporan posko…" />
    <ActionButton type="button" className="button secondary" disabled={busy||!draft.trim()} onClick={()=>void save()}>Simpan di perangkat</ActionButton>
    {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
    <p>{reports.length} laporan di perangkat</p>
    {reports.map(report=><article key={report.id} className="offline-report-item"><p><strong>{report.prepared?'Sudah disiapkan · periksa sebelum mengirim ulang':'Tersimpan di perangkat · belum diproses'}</strong> · {new Date(report.createdAt).toLocaleString('id-ID')}</p><p className="offline-report-text">{report.text}</p><div className="offline-report-actions">{onPrepare&&<ActionButton type="button" className="button secondary" disabled={busy||!canPrepare} onClick={()=>void prepare(report)}>{report.prepared?'Siapkan lagi':'Siapkan untuk diproses'}</ActionButton>}<ActionButton type="button" className="button quiet" disabled={busy} onClick={()=>setDeleteId(report.id)}>Hapus dari perangkat</ActionButton></div>{deleteId===report.id&&<div role="group" aria-label="Konfirmasi hapus laporan"><p>Hapus salinan ini? Penghapusan tidak dapat dibatalkan. Pastikan laporan sudah diproses atau tidak diperlukan.</p><ActionButton type="button" className="button secondary" disabled={busy} onClick={()=>void remove(report.id)}>Ya, hapus salinan</ActionButton><ActionButton type="button" className="button quiet" disabled={busy} onClick={()=>setDeleteId(null)}>Batal</ActionButton></div>}{report.prepared&&<p>Pastikan hasil sebelumnya sebelum menyiapkan ulang agar laporan tidak ganda.</p>}</article>)}
    {onPrepare&&!canPrepare&&<p>Masuk dan hubungkan backend untuk memproses antrean.</p>}
  </section>;
}

export function OfflinePage(){
  const [ready,setReady]=useState(!!navigator.serviceWorker?.controller);
  useEffect(()=>{const update=()=>setReady(!!navigator.serviceWorker?.controller);navigator.serviceWorker?.addEventListener('controllerchange',update);return()=>navigator.serviceWorker?.removeEventListener('controllerchange',update);},[]);
  return <main className="offline-page"><h1>SIGAP · Catatan offline</h1><p role="status">{ready?'Antarmuka tersedia untuk dibuka kembali tanpa internet di browser ini.':'Untuk membuka ulang saat offline, sambungkan internet dan tunggu penyiapan antarmuka.'}</p><p>Antrean hanya ada di perangkat ini. Masuk kembali saat koneksi tersedia untuk memilih pos komando dan memproses laporan.</p><OfflineClassification/><OfflineReports/><p><a href="/">Kembali ke SIGAP / masuk</a></p></main>;
}
