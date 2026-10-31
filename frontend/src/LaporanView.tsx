import React, { useEffect,useRef,useState } from 'react';
import {
  MessageSquare,
  ArrowDown,
  CheckSquare,
  Check,
  ArrowRight,
  Paperclip,
  Droplet,
  Home,
  Baby,
  Cross,
  ChevronDown,
  FileText,
} from 'lucide-react';
import type { Shelter } from './demo';
import {matchesClarificationTarget,type Preview} from './backendPreview';
import type { PendingReview } from './pendingReviews';
import {reviewForShelter} from './pendingReviews';
import { ChatMarkdown } from './ChatMarkdown';
import { metricValue, metrics } from './needs';
import {ReportOverview} from './ReportOverview';
import {StaleReports} from './StaleReports';
import type {RekapFocus} from './chartData';
import {PopulationDetails} from './PopulationDetails';
import {SphereNeedsDetails} from './SphereNeedsDetails';
import {ReportResultSummary} from './ReportResultSummary';
import {DocumentReview} from './DocumentReview';
import type {DocumentExtraction} from './api';
import { sampleReport } from './demo';

export interface LaporanViewProps {
  originalDocument:File|null;
  preferenceKey:string;
  onDropFiles:(files:File[])=>void;
  documentBusy:boolean;
  documentReview:DocumentExtraction|null;
  onCancelDocument:()=>void;
  onUseDocument:(text:string)=>void;
  onDocumentTextChange:(text:string)=>void;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  operationError: string;
  onDismissError: () => void;
  onGoRekap: (focus?:RekapFocus) => void;
  messages: { role: 'user' | 'assistant'; text: string }[];
  input: string;
  onInput: (val: string) => void;
  onSend: () => void;
  onUpload: () => void;
  onClear: () => void;
  onSuggest: (text: string) => void;
  processing: boolean;
  dispatching: boolean;
  composerRef: React.RefObject<HTMLTextAreaElement | null>;
  chatStatus?: string;
  activeRows: Shelter[];
  savedRows: Shelter[];
  onStorageLabel:(s:Shelter)=>string;
  onCalculate:()=>void;
  canCalculate:boolean;
  preview: Preview | null;
  version: number;
  storedLoaded: boolean;
  pendingReviews: PendingReview[];
  storageVerified: boolean;
  saveSubmitted: boolean;
  approved: any;
  onOpenShelterApproval: (s: Shelter) => void;
  canApproveShelter: (s: Shelter) => boolean;
  onSelectShelter: (s: Shelter) => void;
  onClarifyClick?: () => void;
  filename?: string;
  onRemoveFile?: () => void;
  showReportProgress: boolean;
  currentStep: number;
  steps: string[];
  stepCaption: string;
  batchId?: string;
  onLoadDemo?: () => void;
}

export function LaporanView(p: LaporanViewProps) {
  useEffect(()=>{const target=p.headingRef.current;if(target&&!target.closest('[hidden]'))target.focus();},[p.headingRef]);
  const [mobilePanel,setMobilePanel]=useState<'input'|'results'>('input');
  const [collapsed, setCollapsed] = useState(false);
  const preferenceKey=`sigap:diagram:${p.preferenceKey}`;
  const [needsExpanded,setNeedsExpanded]=useState(()=>{try{return localStorage.getItem(`${preferenceKey}:needs`)==='expanded';}catch{return false;}});
  const [statusExpanded,setStatusExpanded]=useState(()=>{try{return localStorage.getItem(`${preferenceKey}:status`)==='expanded';}catch{return false;}});
  const [staleExpanded,setStaleExpanded]=useState(false);
  const overviewExpanded=needsExpanded||statusExpanded||staleExpanded;
  const previewPreferenceKey=`sigap:preview:${p.preferenceKey}`;
  const [previewExpanded,setPreviewExpanded]=useState(()=>{try{return localStorage.getItem(previewPreferenceKey)!=='collapsed';}catch{return true;}});
  useEffect(()=>{try{localStorage.setItem(previewPreferenceKey,previewExpanded?'expanded':'collapsed');}catch{/* Storage can be disabled. */}},[previewPreferenceKey,previewExpanded]);
  useEffect(()=>{try{localStorage.setItem(`${preferenceKey}:needs`,needsExpanded?'expanded':'collapsed');localStorage.setItem(`${preferenceKey}:status`,statusExpanded?'expanded':'collapsed');}catch{/* Storage can be disabled. */}},[preferenceKey,needsExpanded,statusExpanded]);
  const [dragging,setDragging]=useState(false);
  const [selection,setSelection]=useState<Shelter|null>(null);
  const [unread,setUnread]=useState(false);
  const history=useRef<HTMLDivElement>(null),followLatest=useRef(true),previousCount=useRef(p.messages.length);
  const key = (s:Shelter) => JSON.stringify([s.sourceBatchId,s.id,s.name,s.village]);
  const related=selection?p.activeRows.filter(s=>matchesClarificationTarget(s,selection)):[];
  const selected = p.activeRows.find(s=>selection&&key(s)===key(selection)) || (related.length===1?related[0]:undefined) || p.activeRows[0];
  useEffect(()=>{if(selection&&selected&&selection!==selected)setSelection(selected);},[selected,selection]);
  const agentBusy=p.processing||p.dispatching;
  const busy = agentBusy || p.documentBusy;
  function latest(){if(history.current)history.current.scrollTop=history.current.scrollHeight;followLatest.current=true;setUnread(false);}
  useEffect(()=>{
    const added=p.messages.length>previousCount.current;previousCount.current=p.messages.length;
    if(collapsed){if(added)setUnread(true);return;}
    if(followLatest.current)latest();else if(added)setUnread(true);
  },[p.messages,collapsed,busy]);
  function sendMessage(){if(!busy&&p.input.trim()){followLatest.current=true;p.onSend();}}
  const number = (n:number|null|undefined) => n == null ? 'Belum diketahui' : n.toLocaleString('id-ID');
  return <div className="laporan-exact-container">
    <div className="laporan-sub-header"><div><p className="location">PUSAT KENDALI OPERASI</p><h1 ref={p.headingRef} tabIndex={-1}>Laporan & Percakapan</h1><p>Kirim laporan, periksa rekap, atau klarifikasi data posko.</p></div><button type="button" className="button secondary laporan-recap-link" onClick={()=>p.onGoRekap()}>Buka rekap posko</button></div>
    <div className="mobile-report-tabs" role="group" aria-label="Bagian laporan"><button className="button secondary" aria-pressed={mobilePanel==='input'} onClick={()=>setMobilePanel('input')}>Tulis laporan</button><button className="button secondary" aria-pressed={mobilePanel==='results'} onClick={()=>setMobilePanel('results')}>Hasil pemeriksaan{p.pendingReviews.length?` (${p.pendingReviews.length})`:''}</button></div>
    <div className={`laporan-two-col-grid laporan-workspace mobile-panel-${mobilePanel}${overviewExpanded?' has-overview':''}${!previewExpanded?' preview-collapsed':''}`}>
      <aside className="report-sidebar"><ReportOverview onCalculate={p.onCalculate} busy={busy} canCalculate={p.canCalculate} shelters={p.activeRows} hasPending={!!p.preview||p.pendingReviews.length>0} stored={p.storedLoaded||p.storageVerified} onGoRekap={p.onGoRekap} needsExpanded={needsExpanded} statusExpanded={statusExpanded} onToggleNeeds={()=>setNeedsExpanded(v=>!v)} onToggleStatus={()=>setStatusExpanded(v=>!v)}/><StaleReports expanded={staleExpanded} onToggleExpanded={()=>setStaleExpanded(v=>!v)} shelters={p.savedRows} onSelect={saved=>{const matches=p.activeRows.filter(row=>matchesClarificationTarget(row,saved));if(matches.length===1)p.onSelectShelter(matches[0]);else p.onGoRekap();}}/></aside>
      <section className="laporan-chat-card" aria-label="Percakapan laporan">
        <div className="chat-card-header chat-dock-heading"><div><h2><MessageSquare size={18}/> Percakapan SIGAP</h2></div><button type="button" className="button quiet" aria-controls="chat-history-panel" aria-expanded={!collapsed} onClick={()=>setCollapsed(v=>!v)}>{collapsed?'Buka percakapan':'Ciutkan percakapan'}</button></div>
        <div id="chat-history-panel" className={`disclosure-motion chat-history-motion${collapsed?' is-closed':''}`} aria-hidden={collapsed} inert={collapsed}><div className="disclosure-inner"><div className="chat-conversation-area" ref={history} role="log" aria-label="Riwayat percakapan" onScroll={()=>{const el=history.current;if(el){followLatest.current=el.scrollHeight-el.scrollTop-el.clientHeight<48;if(followLatest.current)setUnread(false);}}}>
          {!p.messages.length && <div className="chat-message assistant figma-agent-bubble"><p>Kirim laporan atau tanyakan data posko.</p></div>}
          {p.messages.map((m,i)=><div key={i} className={`chat-bubble-row ${m.role==='user'?'operator-bubble-row':'agent-bubble-row'}`}><span className="bubble-author-label">{m.role==='user'?'Anda':'SIGAP · Agent'}</span><div className={`chat-message ${m.role} ${m.role==='user'?'figma-operator-bubble':'figma-agent-bubble'}`}>{m.role==='assistant'?<ChatMarkdown text={m.text}/>:<p>{m.text}</p>}</div></div>)}
          {agentBusy&&!collapsed&&<p className="chat-response-status ai-activity" role="status"><span className="ai-activity-dot" aria-hidden="true"/>{p.chatStatus || 'Agent sedang memproses…'}</p>}
        </div>{unread&&<button type="button" className="button secondary chat-unread-link" onClick={latest}><ArrowDown size={16} aria-hidden="true"/>Pesan terbaru</button>}</div></div>
        {collapsed&&agentBusy&&<p className="chat-response-status ai-activity" role="status"><span className="ai-activity-dot" aria-hidden="true"/>{p.chatStatus || 'Agent sedang memproses…'}</p>}
        {p.showReportProgress && <div className="report-progress-section"><ol className="steps" aria-label={p.batchId?`Progres batch ${p.batchId}`:'Progres batch'}>{p.steps.map((s,i)=><li key={s} className={i===p.currentStep?'current':i<p.currentStep?'done':''} aria-current={i===p.currentStep?'step':undefined}><span className="step-dot">{i+1}</span>{s}</li>)}</ol><p className="steps-caption" role="status">{p.stepCaption}</p></div>}
        <div className="quick-suggestions-row"><button className="quick-chip-btn" onClick={()=>p.onSuggest('Tolong cek rekap posko yang sudah tersimpan dan ringkas isinya.')}>Cek rekap tersimpan</button><button className="quick-chip-btn" onClick={()=>p.onLoadDemo?p.onLoadDemo():p.onSuggest(sampleReport)}>Pakai laporan contoh</button><button className="quick-chip-btn" onClick={()=>p.onSuggest('Periksa kebutuhan air bersih di semua posko dari rekap saat ini.')}>Posko mana yang butuh air?</button></div>
        {p.filename && <div className="file-attached-bar" role="status">Siap digunakan · Berkas: {p.filename}<button onClick={p.onRemoveFile}>Lepas</button></div>}
        {p.operationError&&<div className="operation-error" role="alert"><p>{p.operationError}</p>{/simpan|verifikasi|hasil proses.*terkonfirmasi/i.test(p.operationError)?<><p>Periksa hasil di rekap sebelum mengirim ulang.</p><button className="button secondary" onClick={()=>p.onGoRekap()}>Periksa rekap</button></>:<p>Isian yang belum terkirim tetap tersedia untuk diperbaiki.</p>}<button type="button" className="button quiet" onClick={p.onDismissError}>Tutup pesan gagal</button></div>}
        <DocumentReview original={p.originalDocument} document={p.documentReview} busy={p.documentBusy} hasDraft={!!p.input.trim()} onUse={p.onUseDocument} onCancel={p.onCancelDocument} canUse={!agentBusy} onTextChange={p.onDocumentTextChange}/>
        <div className={`chat-composer-box${dragging?' is-dragging':''}`} onDragOver={e=>{if(Array.from(e.dataTransfer.types).includes('Files')){e.preventDefault();if(!busy)setDragging(true);}}} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setDragging(false);}} onDrop={e=>{if(!Array.from(e.dataTransfer.types).includes('Files'))return;e.preventDefault();setDragging(false);if(!busy)p.onDropFiles(Array.from(e.dataTransfer.files));}}>{dragging&&<p className="drop-hint" role="status">Lepaskan satu berkas untuk dibaca</p>}<label className="sr-only" htmlFor="report-input">Laporan atau pertanyaan Anda</label><textarea id="report-input" ref={p.composerRef} rows={4} placeholder="Tulis laporan atau pertanyaan…" value={p.input} onChange={e=>p.onInput(e.target.value)} onPaste={e=>{const images=Array.from(e.clipboardData.items).filter(item=>item.kind==='file'&&item.type.startsWith('image/'));if(!images.length)return;e.preventDefault();if(busy)return;const files=images.map((item,index)=>{const file=item.getAsFile();if(!file)return null;const extension=item.type==='image/png'?'png':item.type==='image/jpeg'?'jpg':'unsupported';return new File([file],`clipboard-${index+1}.${extension}`,{type:file.type});}).filter((file):file is File=>file!==null);if(files.length)p.onDropFiles(files);}} onKeyDown={e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter'&&!e.nativeEvent.isComposing){e.preventDefault();sendMessage();}}}/><div className="composer-footer-bar"><span>{p.input.length} karakter</span><div className="composer-action-buttons"><button className="composer-clean-btn" onClick={p.onClear}>Bersihkan</button><button className="composer-upload-btn" disabled={busy} onClick={p.onUpload}><Paperclip size={15}/>Unggah berkas</button><button className="button primary" aria-label="Kirim" disabled={!p.input.trim()||busy} onClick={sendMessage}>Kirim & Proses<ArrowRight size={15}/></button></div></div></div>
        {p.preview&&<div className="mobile-result-ready"><span>Hasil pemeriksaan tersedia · belum disimpan</span><button type="button" className="button secondary" onClick={()=>setMobilePanel('results')}>Lihat hasil pemeriksaan<ArrowRight size={15} aria-hidden="true"/></button></div>}
        <p className="composer-help">Tarik berkas atau tempel gambar · Ctrl / ⌘ + Enter untuk mengirim</p>
        <details className="composer-guidance"><summary>Panduan berkas & privasi</summary><p>TXT/CSV: maksimal 200 KiB. PDF, JPG, PNG: maksimal 5 MiB; PDF maksimal 5 halaman. Periksa hasil OCR sebelum mengirim.</p><p>Pola NIK, nomor telepon, email, dan rekening disaring oleh backend sebelum dikirim ke model.</p></details>
      </section>
      <section className={`laporan-extraction-card functional-extraction${!selected?' is-empty':''}${!previewExpanded?' is-collapsed':''}`} aria-labelledby="preview-title">
        <div className="preview-panel-heading"><h2 id="preview-title">Pratinjau rekap</h2><button type="button" className="button quiet preview-toggle" aria-controls="preview-panel-content" aria-expanded={previewExpanded} onClick={()=>setPreviewExpanded(v=>!v)}>{previewExpanded?'Ciutkan':'Buka'}<ChevronDown size={16} className={previewExpanded?'preview-chevron expanded':'preview-chevron'} aria-hidden="true"/></button></div>
        {!previewExpanded&&<p className="preview-collapsed-summary">{p.pendingReviews.length?`${p.pendingReviews.length} draf menunggu tinjauan`:p.preview?'Kandidat menunggu tinjauan':`${p.activeRows.length} posko`}</p>}
        <div className={`disclosure-motion preview-motion${!previewExpanded?' is-closed':''}`} aria-hidden={!previewExpanded} inert={!previewExpanded}><div className="disclosure-inner"><div id="preview-panel-content" className="preview-panel-content">
        <div className="preview-overview-meta"><p className="muted">{p.activeRows.length?`${p.activeRows.length} posko${p.preview?` · kandidat versi ${p.version}`:''}`:'Belum ada posko'}</p><span className={`badge ${p.storageVerified?'success':'neutral'}`}>{p.storageVerified||p.storedLoaded&&!p.preview?'Rekap tersimpan':p.preview?'Belum disimpan':'Belum ada kandidat rekap'}</span></div>
        {p.pendingReviews.length>0&&<p className="preview-pending-hint">{p.pendingReviews.length} perubahan menunggu tinjauan.</p>}
        {selected ? <><label className="field-label preview-select">Pilih posko<select aria-label="Pilih posko pratinjau" value={key(selected)} onChange={e=>setSelection(p.activeRows.find(s=>key(s)===e.target.value)||null)}>{p.activeRows.map(s=><option key={key(s)} value={key(s)}>{s.name} · {s.village}</option>)}</select></label><ReportResultSummary shelter={selected} savedRows={p.savedRows} pending={!!reviewForShelter(p.pendingReviews,selected)} storageLabel={p.onStorageLabel(selected)} busy={busy} canApprove={p.canApproveShelter(selected)} onOpen={()=>p.onSelectShelter(selected)} onApprove={()=>p.onOpenShelterApproval(selected)}/><details className="preview-reported-needs"><summary>Kebutuhan yang dilaporkan</summary><p>{selected.needs.join(', ')||'Belum dilaporkan'}</p></details><details className="preview-details"><summary>Rincian jiwa & perkiraan kebutuhan</summary><div className="preview-details-content"><PopulationDetails shelter={selected}/><SphereNeedsDetails shelter={selected} onCalculate={p.onCalculate} canCalculate={p.canCalculate} busy={busy} onClarify={()=>p.onSelectShelter(selected)}/>{selected.note&&<p className="note">{selected.note}</p>}</div></details></> : <div className="empty"><FileText/><p>Kirim laporan atau baca rekap tersimpan.</p></div>}
        

        </div></div></div>
      </section>
    </div>
  </div>;
}
