import {useEffect, useRef, useState} from 'react';
import {ArrowDownToLine, Check, ChevronRight, Copy, FileText, Info, Plus, Search, ShieldCheck, TriangleAlert, X} from 'lucide-react';
import {shelters, sampleReport, bulletin, type Shelter, type RequirementKey} from './demo';
import {approveDemoReview, validateReportFile, type ClearDecision} from './review';
import {checkBackendHealth, createBackendSession, sendBackendMessage, submitBatchDecision, getSessionToken, type HealthResponse} from './api';
import {connectEventStream} from './stream';
import {previewRows, storedRows, pendingClearFields, matchesClarificationTarget, type Preview} from './backendPreview';
import {receiveReview,pendingRows,reviewForShelter,reviewLabel,applyReviewCalculations,type PendingReview} from './pendingReviews';
import {ChatDock} from './ChatDock';
import {BrandLogo} from './BrandLogo';
import {MarkdownContent} from './MarkdownContent';
import {bulletinForReading} from './bulletin';
import {ReviewChecklist} from './ReviewChecklist';
import {reviewSummary} from './reviewIndicators';
import {ClarificationForm, type ClarificationFeedback, type ClarificationChanges} from './ClarificationForm';
import {ConflictReview,storageConflicts,type ConflictChoices} from './ConflictReview';
import {stageLabel, isReportStage, isReadOnlyStage} from './stageLabels';

import {metricValue, metrics, recapCsv} from './needs';

type Page = 'Laporan' | 'Rekap' | 'Buletin';
type View = 'Posko' | 'Kebutuhan';
const number = (value:number|null) => value === null ? 'Belum diketahui' : new Intl.NumberFormat('id-ID').format(value);
const pages: Page[] = ['Laporan','Rekap','Buletin'];
const steps = ['Input','Proses','Tinjau','Simpan'];
function Badge({status}:{status:string}){const tone=['Perlu klarifikasi','Menunggu persetujuan'].includes(status)?'warning':['Parsial','Belum tersedia','Memperbarui…','Dari penyimpanan'].includes(status)?'neutral':'success';return <span className={`badge ${tone}`}><span/>{status}</span>}

export default function App(){
  const [page,setPage] = useState<Page>('Laporan');
  const [view,setView] = useState<View>('Posko');
  const [metricKey,setMetricKey] = useState<RequirementKey>('air_liter_per_hari');
  const metric=metrics.find(m=>m.key===metricKey)!;
  const quantity=(row:Shelter,shortage=false)=>{const v=metricValue(row,metricKey,shortage);return v===null?'Belum diketahui':`${!shortage&&row.estimate?'≈ ':''}${number(v)} ${metric.unit}`;};
  const [query,setQuery] = useState('');
  const [filter,setFilter] = useState('Semua status');
  const [input,setInput] = useState('');
  const [filename,setFilename] = useState<string|undefined>();
  const [conflictChoices,setConflictChoices] = useState<ConflictChoices>({});
  const [messages,setMessages] = useState<{role:'user'|'assistant';text:string}[]>([]);
  const [detail,setDetail] = useState<Shelter|null>(null);
  const [modal,setModal] = useState<'approve'|'connection'|null>(null);
  const [version,setVersion] = useState(1);
  const [reviewedVersion,setReviewedVersion] = useState(1);
  const [confirmed,setConfirmed] = useState(false);
  const [partial,setPartial] = useState(false);
  const [decision,setDecision] = useState<ClearDecision>('');
  const [approved,setApproved] = useState<ReturnType<typeof approveDemoReview>|null>(null);
  const [notice,setNotice] = useState('');
  const [error,setError] = useState('');
  const [clarificationFeedback,setClarificationFeedback] = useState<ClarificationFeedback>(null);
  const clarificationAttempt = useRef<{shelter:Shelter;expected:ClarificationChanges;batchId?:string;received:boolean}|null>(null);

  // Backend live integration state
  const [health,setHealth] = useState<HealthResponse|null>(null);
  const [sessionId,setSessionId] = useState<string>('');
  const [batchId,setBatchId] = useState<string>('');
  const [snapshotId,setSnapshotId] = useState<string>('');
  const [processing,setProcessing] = useState<boolean>(false);
  const [dispatching,setDispatching] = useState(false);
  const dispatchInFlight = useRef(false);
  const previewRevision = useRef(0);
  const workspaceRevision = useRef(0);
  const completionRevision = useRef(0);
  const [stage,setStage] = useState<string>('');
  const [activeRows,setActiveRows] = useState<Shelter[]>(shelters);
  const [activeBulletin,setActiveBulletin] = useState<string>(bulletin);
  const [storageVerified,setStorageVerified] = useState<boolean>(false);
  const [preview,setPreview] = useState<Preview|null>(null);
  const pendingReviewRef=useRef<PendingReview[]>([]);
  const [pendingReviews,setPendingReviews]=useState<PendingReview[]>([]);
  const submittedReviews=useRef(new Set<string>());
  const [clearChoices,setClearChoices] = useState<Record<string,Record<string,ClearDecision>>>({});
  const [saveSubmitted,setSaveSubmitted] = useState(false);
  // Rekap yang dibaca otomatis dari penyimpanan pada pesan pertama. Bukan kandidat, jadi tidak bisa disetujui.
  const [storedLoaded,setStoredLoaded] = useState(false);
  // Alur laporan (ekstrak/validasi/simpan) sedang berjalan. Chat biasa tidak menggerakkan indikator langkah.
  const [reportInFlight,setReportInFlight] = useState(false);
  const [activity,setActivity] = useState<'chat'|'read'|'report'>('chat');
  const candidateRef = useRef('');
  // Rekap tersimpan sebagai dasar: kandidat (mis. koreksi satu posko) digabung ke sini, tidak menggantikannya.
  const storedBase = useRef<Shelter[]>([]);
  const rowsRef = useRef<Shelter[]>([]);
  // Batch milik rekap yang sedang ditinjau. Terpisah dari batch pesan terbaru, supaya chat lanjutan
  // tidak menimpa pasangan batch+snapshot yang masih bisa disetujui.
  const [candidateBatchId,setCandidateBatchId] = useState<string>('');
  const latestBatch = useRef('');
  useEffect(()=>{candidateRef.current=candidateBatchId;},[candidateBatchId]);
  // Waktu & jenis event terakhir dari server, dipakai untuk mendeteksi giliran yang sudah selesai.
  const lastEvent = useRef<{type:string;at:number}>({type:'',at:0});
  const tracked = (h:Record<string,(d:any)=>void>)=>Object.fromEntries(Object.entries(h).map(([k,fn])=>[k,(d:any)=>{lastEvent.current={type:k,at:Date.now()};fn(d);}]));
  rowsRef.current = activeRows;
  const pendingFields = preview ? pendingClearFields(preview) : [];
  const needsPartial = !!preview && (preview.issues?.length || preview.records?.some(r=>r.missing_fields?.length||r.validation_issues?.length||r.pending_clear_fields?.length||r.unverified_numbers?.length||r.storage_conflicts?.length));

  const upload = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const focusComposer = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const previousPage = useRef(page);

  // Initialize and check backend connection
  useEffect(()=>{
    let active=true;
    checkBackendHealth().then(h=>{
      if(h&&active){
        setHealth(h);
        createBackendSession().then(s=>{if(!active)return;setSessionId(s.session_id);setActiveRows([]);setActiveBulletin('Belum ada draf dari server.');}).catch(err=>{if(active)setNotice(err.message);});
      }
    });
    return()=>{active=false;};
  },[]);

  // Fetch streaming supports Bearer headers and Last-Event-ID replay.
  useEffect(()=>{
    if(!sessionId) return;
    const stream = connectEventStream(`/api/sessions/${sessionId}/events`, () => getSessionToken(), tracked({
      stage_changed: data=>{
        const attempt=clarificationAttempt.current;
        if(attempt&&!attempt.batchId)attempt.batchId=data.batch_id;
        setStage(data.stage||'');
        if(isReportStage(data.stage)){setReportInFlight(true);setActivity('report');}
        else if(isReadOnlyStage(data.stage))setActivity(previous=>previous==='report'?'report':'read');
        if(attempt?.received&&attempt.batchId===data.batch_id){
          if(data.stage==='recalculate_correction')setClarificationFeedback(previous=>previous?.kind==='success'?{kind:'pending',text:'Kandidat baru diterima. Menghitung ulang kebutuhan…'}:previous);
          if(data.stage==='recalculation_failed')setClarificationFeedback(previous=>previous?.kind==='pending'?{kind:'success',text:data.message}:previous);
        }
      },
      // Server menandai operasi selesai. Tanpa ini, indikator "memproses" baru mati setelah jeda diam beberapa detik.
      processing_completed: data=>{
        if(data.batch_id&&data.batch_id!==latestBatch.current&&data.batch_id!==candidateRef.current&&data.batch_id!==clarificationAttempt.current?.batchId) return;
        completionRevision.current++; setProcessing(false); setReportInFlight(false); setStage('');
        if(clarificationAttempt.current&&(!data.batch_id||data.batch_id===clarificationAttempt.current.batchId)){
          if(!clarificationAttempt.current.received)failClarification('Belum ada kandidat perubahan yang tervalidasi. Periksa atau kirim ulang klarifikasi.');
          clarificationAttempt.current=null;
        }
      },
      assistant_message: data=>{if(data.chunk||data.text)setMessages(m=>[...m,{role:'assistant',text:data.chunk||data.text}]);},
      preview_ready: data=>{
        setActivity('report');
        workspaceRevision.current++;
        previewRevision.current++;
        setStoredLoaded(false);
        const review={batchId:data.batch_id||latestBatch.current,preview:data};
        pendingReviewRef.current=receiveReview(pendingReviewRef.current,review);
        setPendingReviews(pendingReviewRef.current);
        activateReview(review);
        const candidateRows=previewRows(data);
        const merged=pendingRows(storedBase.current,pendingReviewRef.current,rowsRef.current);
        setActiveRows(merged);
        const attempt=clarificationAttempt.current;
        if(attempt&&(!attempt.batchId||attempt.batchId===data.batch_id)){
          attempt.batchId=data.batch_id;
          const matches=candidateRows.filter(row=>matchesClarificationTarget(row,attempt.shelter));
          if(matches.length===1){
            attempt.received=true;
            const updated=merged.find(row=>matchesClarificationTarget(row,attempt.shelter))||matches[0];
            setDetail(current=>current?updated:null);
            const applied=Object.entries(attempt.expected).every(([key,value])=>matches[0][key as keyof ClarificationChanges]===value);
            if(!applied)failClarification('Kandidat baru belum menerapkan seluruh angka yang diminta. Periksa hasil validasi; isian koreksi dipertahankan untuk diperiksa atau dikirim ulang.');
            else setClarificationFeedback({kind:'success',text:data.simulated?'Pratinjau sintetis diterima dari backend mock. Periksa angka hasil simulasi; belum ada penyimpanan nyata.':'Kandidat baru diterima. Periksa angka hasil validasi di sini; perubahan belum disimpan.'});
          }else failClarification('Hasil validasi belum memuat satu posko yang sesuai. Periksa target klarifikasi sebelum melanjutkan.');
        }
        setVersion(v=>v+1); setClearChoices({}); setConflictChoices({}); setSaveSubmitted(false); setStorageVerified(false);
        setActiveBulletin('Belum ada draf buletin untuk kandidat ini.');
        setNotice(data.simulated?'Pratinjau sintetis dari backend mock tersedia.':'Kandidat baru tersedia. Perubahan posko lain yang belum disimpan tetap ditampilkan.');
      },
      stored_rekap_ready: data=>{
        workspaceRevision.current++;
        const rows=storedRows(data.records||[]);
        storedBase.current = rows;
        setActiveRows(pendingRows(rows,pendingReviewRef.current,rowsRef.current));
        setStoredLoaded(!pendingReviewRef.current.length&&rows.length>0);
        setNotice('Rekap tersimpan dimuat otomatis dari penyimpanan.');
      },
      approval_required: ()=>{completionRevision.current++;setProcessing(false);},
      storage_result: data=>setNotice(data.simulated?'Simulasi write sedang diperiksa.':'Data rekap sedang diverifikasi ke penyimpanan...'),
      readback_result: data=>{
        setActivity('read');
        completionRevision.current++;
        const verified = data.verification_status==='verified'&&!data.simulated;
        setStorageVerified(verified); setProcessing(false);
        if(verified&&!data.simulated){
          const persisted=storedRows(data.records||[]);
          if(persisted.length)storedBase.current=persisted;
          const committedBatch=data.batch_id;
          pendingReviewRef.current=pendingReviewRef.current.filter(review=>review.batchId!==committedBatch);
          submittedReviews.current.delete(committedBatch);
          setPendingReviews(pendingReviewRef.current);
          setActiveRows(pendingRows(storedBase.current,pendingReviewRef.current,rowsRef.current));
          activateReview(pendingReviewRef.current.at(-1)||null);
          setStoredLoaded(!pendingReviewRef.current.length);
          setStorageVerified(!pendingReviewRef.current.length);
          setFilter('Semua status');
        }
        setNotice(data.simulated?'Simulasi penyimpanan selesai. Tidak ada data ditulis ke penyimpanan nyata.':verified?'Tersimpan dan terverifikasi di penyimpanan.':'Verifikasi read-back belum sesuai. Tinjau perbedaan sebelum melanjutkan.');
      },
      calculation_ready: data=>{
        workspaceRevision.current++;
        setActiveRows(rows=>applyReviewCalculations(rows,pendingReviewRef.current,data));
        setDetail(current=>current?applyReviewCalculations([current],pendingReviewRef.current,data)[0]:null);
        const attempt=clarificationAttempt.current;
        if(data.automatic_recalculation&&attempt?.received&&attempt.batchId===data.batch_id)setClarificationFeedback(previous=>previous?.kind!=='error'?{kind:'success',text:'Kandidat baru diterima. Kebutuhan sudah dihitung ulang; perubahan belum disimpan.'}:previous);
      },
      bulletin_ready: data=>{if(data.content)setActiveBulletin(data.content);},
      error: data=>{completionRevision.current++;setProcessing(false);const message=data.message||'Proses belum dapat diverifikasi.';setNotice(message);failClarification(message,data.batch_id);}
    }), err=>{completionRevision.current++;setProcessing(false);setNotice(err.message);failClarification(err.message);});
    return ()=>stream.close();
  },[sessionId]);

  // Pengaman agar "memproses" tidak tersangkut: chat biasa tidak mengirim sinyal selesai dari server.
  useEffect(()=>{
    if(!processing) return;
    const timer=setInterval(()=>{
      const {type,at}=lastEvent.current, idle=Date.now()-at;
      if((type==='assistant_message'&&idle>6000)||idle>330000){
        completionRevision.current++; setProcessing(false);
        failClarification('Validasi belum selesai. Perubahan belum diterapkan. Periksa koneksi sebelum mengirim ulang.');
        if(type!=='assistant_message') setNotice('Agent belum merespons. Anda bisa mengirim pesan lagi.');
      }
    },1000);
    return ()=>clearInterval(timer);
  },[processing]);

  useEffect(()=>{if(modal||detail)dialog.current?.showModal();else dialog.current?.close();},[modal,detail]);
  useEffect(()=>{if(previousPage.current!==page){previousPage.current=page;heading.current?.focus();}if(page==='Laporan'&&focusComposer.current){focusComposer.current=false;composer.current?.focus();}},[page,detail]);
  useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),5000);return()=>clearTimeout(timer);},[notice]);

  const rows = activeRows.filter(s=>`${s.name} ${s.village}`.toLowerCase().includes(query.toLowerCase())&&(filter==='Semua status'||(filter==='Perlu pemeriksaan'?s.status!=='Siap ditinjau':s.status===filter)));

  const needsCheck = activeRows.filter(r=>r.status!=='Siap ditinjau').length;
  const clarifyCount = activeRows.filter(r=>r.status==='Perlu klarifikasi').length;
  const partialCount = activeRows.filter(r=>r.status==='Parsial').length;
  // Progres mengikuti keadaan nyata: tidak mundur saat pesan lanjutan, dan tidak pura-pura "proses" di mode demo.
  const currentStep = processing&&reportInFlight&&!preview ? 1 : storageVerified ? 4 : (saveSubmitted||approved) ? 3 : preview ? 2 : 0;
  const showReportProgress=activity==='report'&&!!(processing||preview||(!storageVerified&&(saveSubmitted||approved)));
  const stageText = stageLabel(stage);
  const chatStatus = processing ? (stageText || (reportInFlight ? 'Memeriksa laporan…' : 'Agent sedang menjawab…')) : '';
  const stepCaption = processing&&reportInFlight&&!preview ? (stageText||'Memproses laporan…') : storageVerified ? 'Rekap tersimpan dan terverifikasi.'
    : saveSubmitted ? 'Keputusan tercatat. Menunggu hasil verifikasi.'
    : preview ? 'Kandidat siap ditinjau. Buka halaman Rekap untuk memeriksa dan menyetujui.'
    : (processing&&reportInFlight) ? (stageText || 'Memproses laporan…')
    : 'Menunggu hasil pemeriksaan laporan.';
  const suggestions = [
    {label:'Cek rekap tersimpan', text:'Tolong cek rekap posko yang sudah tersimpan dan ringkas isinya.'},
    {label:'Pakai laporan contoh', text:sampleReport},
    {label:'Posko mana yang butuh air?', text:'Posko mana saja yang paling butuh air bersih saat ini?'}
  ];
  const statusTone = !health ? 'demo' : health.mode==='live' ? 'online' : 'warn';
  const statusLabel = health ? (health.mode==='mock_mode'?'Backend Mock':['gemini','openai'].includes(health.agent||'')?(health.mode==='live'?'LLM dikonfigurasi':'LLM belum siap'):health.mode==='live'?'Agent tersedia':'Koneksi bermasalah') : 'Mode demo';
  function goReview(){setView('Posko');setFilter('Perlu pemeriksaan');setQuery('');setPage('Rekap');}

  function close(){dialog.current?.close();setModal(null);setDetail(null);setError('');setClarificationFeedback(null);clarificationAttempt.current=null;}

  function failClarification(message:string,batch?:string){
    const attempt=clarificationAttempt.current;
    if(!attempt||(batch&&attempt.batchId&&attempt.batchId!==batch))return;
    setClarificationFeedback({kind:'error',text:message});clarificationAttempt.current=null;
  }

  function loadDemo(){
    setInput(sampleReport);
    setVersion(v=>v+1);
    setApproved(null);
    setNotice('Contoh laporan dimuat. Anda dapat membaca laporan atau membuka rekap demo.');
    composer.current?.focus();
  }

  async function send(override?:string):Promise<{ok:boolean;message?:string;batchId?:string}>{
    const raw = override ?? input;
    if(!raw.trim()||dispatchInFlight.current) return {ok:false,message:'Tunggu proses yang sedang berjalan sebelum mengirim perubahan.'};
    const textToSend = raw.trim();

    if(!health||!sessionId){
      // Demo mode fallback
      setInput(''); setApproved(null); setVersion(v=>v+1);
      setMessages(m=>[...m,{role:'user',text:textToSend},{role:'assistant',text:'Pesan diterima di sesi lokal. Agen belum terhubung, jadi laporan ini belum dianalisis. Anda dapat meninjau rekap contoh untuk mencoba alur pemeriksaan.'}]);
      return {ok:true};
    }

    // Live mode backend dispatch
    const previousPreviewRevision = previewRevision.current;
    const previousWorkspaceRevision = workspaceRevision.current;
    dispatchInFlight.current=true; setDispatching(true);
    lastEvent.current={type:'sent',at:Date.now()};
    setProcessing(true); setReportInFlight(false); setActivity('chat'); setStage('');
    try{
      const res = await sendBackendMessage(sessionId, textToSend,override===undefined?filename:undefined);
      setBatchId(res.batch_id);
      setInput(current=>current.trim()===textToSend?'':current);
      if(override===undefined)setFilename(undefined);
      setMessages(m=>[...m,{role:'user',text:textToSend}]);
      setApproved(null);
      // A fast SSE preview may precede the HTTP response. Preserve that candidate.
      latestBatch.current=res.batch_id;
      if(previewRevision.current===previousPreviewRevision&&!pendingReviewRef.current.length&&!preview&&!storedLoaded&&workspaceRevision.current===previousWorkspaceRevision){
        // Belum ada rekap sama sekali: mulai bersih. Jika sudah ada, rekap lama dipertahankan
        // sampai rekap baru tiba, jadi pesan lanjutan tidak menghapus pekerjaan.
        setVersion(v=>v+1); setStorageVerified(false);
        setSnapshotId(''); setSaveSubmitted(false);
        setActiveRows([]); setActiveBulletin('Belum ada draf buletin untuk laporan ini.');
      }
      if(res.pii_summary?.totalRedacted>0){
        setNotice(`${res.pii_summary.totalRedacted} pola data pribadi disaring secara otomatis.`);
      }
      return {ok:true,batchId:res.batch_id};
    }catch(err:any){
      setProcessing(false);
      setNotice(err?.message||'Gagal mengirim laporan ke backend.');
      return {ok:false,message:err?.message||'Gagal mengirim laporan ke backend.'};
    }finally{
      dispatchInFlight.current=false; setDispatching(false);
    }
  }

  async function readFile(file:File){
    try{
      validateReportFile(file.name,file.size);
      const text=new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer());
      if(!text.trim())throw new Error('Laporan kosong. Pilih file dengan isi laporan.');
      setInput(text);
      setFilename(file.name);
      setNotice(`${file.name} dimuat. Laporan belum dikirim.`);
      composer.current?.focus();
    }catch(e){
      setNotice(e instanceof Error?e.message:'File tidak dapat dibaca.');
    }finally{
      if(upload.current)upload.current.value='';
    }
  }

  // Minta Agent menyusun draf dari halaman Buletin. Hasil tiba lewat SSE (bulletin_ready); hanya pratinjau.
  function requestBulletin(){
    void send('Tolong susun draf buletin donatur dari rekap yang ada saat ini. Hanya pratinjau (action preview), jangan membuat dokumen.');
  }

  function activateReview(review:PendingReview|null){
    candidateRef.current=review?.batchId||'';
    setCandidateBatchId(review?.batchId||'');
    setPreview(review?.preview||null);
    setSnapshotId(review?.preview.snapshot_id||'');
    setSaveSubmitted(!!review&&submittedReviews.current.has(review.batchId));
    setConfirmed(false);setPartial(false);setDecision('');setClearChoices({});setConflictChoices({});setError('');
    if(review)setStorageVerified(false);
  }

  function openShelterApproval(shelter:Shelter){
    const owner=reviewForShelter(pendingReviewRef.current,shelter);
    if(!owner)return;
    activateReview(owner);
    openApproval();
  }

  function reviewPicker(){
    return pendingReviews.length>0&&<div className="pending-reviews"><label className="field-label">Kandidat untuk disetujui<select aria-label="Kandidat untuk disetujui" value={candidateBatchId} disabled={processing||dispatching} onChange={e=>activateReview(pendingReviews.find(review=>review.batchId===e.target.value)||null)}>{pendingReviews.map(review=><option key={review.batchId} value={review.batchId}>{reviewLabel(review)}{submittedReviews.current.has(review.batchId)?' · keputusan terkirim':''}</option>)}</select></label><p>{pendingReviews.length} kandidat belum selesai disimpan. Rekap menampilkan seluruh perubahan; persetujuan hanya berlaku untuk kandidat yang dipilih.</p></div>;
  }

  function openApproval(){
    setReviewedVersion(version);
    setConfirmed(false);
    setPartial(false);
    setDecision('');
    setClearChoices({});
    setConflictChoices({});
    setDetail(null); setError('');
    setModal('approve');
  }

  async function approve(){
    if(dispatchInFlight.current)return;
    try{
      if(health && candidateBatchId && snapshotId){
        // Live server approval
        if(version !== reviewedVersion) throw new Error('Kandidat berubah. Periksa versi terbaru.');
        if(!confirmed) throw new Error('Berikan persetujuan eksplisit atas pratinjau ini.');
        if(saveSubmitted||processing||dispatchInFlight.current) throw new Error('Keputusan penyimpanan sudah dikirim.');
        if(needsPartial&&!partial) throw new Error('Konfirmasi batas data parsial terlebih dahulu.');
        if(pendingFields.some(p=>!clearChoices[p.reportId]?.[p.field])) throw new Error('Putuskan setiap usulan pengosongan field.');
          if(storageConflicts(preview).some((c:any)=>!conflictChoices[c.reportId]?.[c.field]))throw new Error('Putuskan setiap konflik dengan rekap tersimpan.');

        const previousCompletionRevision=completionRevision.current;
        submittedReviews.current.add(candidateBatchId);
        dispatchInFlight.current=true; setDispatching(true); setProcessing(true);setActivity('report');
        lastEvent.current={type:'sent',at:Date.now()};
        await submitBatchDecision(candidateBatchId, {
          action: 'approve_save',
          snapshot_id: snapshotId,
          partial_acknowledged: partial,
          clear_decisions: clearChoices as Record<string,Record<string,'clear'|'keep'|'defer'>>,
          ...(storageConflicts(preview).length?{conflict_decisions:conflictChoices}:{})
        });
        close();
        setSaveSubmitted(submittedReviews.current.has(candidateRef.current));
        if(completionRevision.current===previousCompletionRevision){
          setNotice(health.mode==='mock_mode'?'Persetujuan simulasi tercatat. Memulai pemeriksaan sintetis.':'Persetujuan tercatat di server. Memulai write dan read-back...');
        }
      } else {
        // Demo mode simulation
        setApproved(approveDemoReview({version,reviewedVersion,confirmed,partial,clearDecision:decision}));
        close();
        setNotice('Simulasi persetujuan tercatat. Data belum disimpan ke backend.');
      }
    }catch(e){
      submittedReviews.current.delete(candidateBatchId);
      if(dispatchInFlight.current)setProcessing(false);
      setError((e as Error).message);
    }finally{
      dispatchInFlight.current=false; setDispatching(false);
    }
  }

  async function clarify(s:Shelter,text:string,expected:ClarificationChanges){
    if(!health||!sessionId){setClarificationFeedback({kind:'error',text:'Hubungkan backend untuk memvalidasi perubahan.'});return;}
    if(processing||dispatchInFlight.current){setClarificationFeedback({kind:'error',text:'Tunggu proses yang sedang berjalan sebelum mengirim perubahan.'});return;}
    const report=s.correctionTarget?.report_id??s.id, batch=s.correctionTarget?.batch_id??s.sourceBatchId;
    clarificationAttempt.current={shelter:s,expected,received:false};
    setClarificationFeedback({kind:'pending',text:'Memvalidasi perubahan. Angka lama tetap ditampilkan sampai kandidat baru diterima.'});
    const result=await send(`Mohon klarifikasi laporan ${report} (${s.name})${batch?` batch ${batch}`:''}: ${text}`);
    if(!result.ok)failClarification(result.message||'Klarifikasi gagal dikirim.');
    else if(clarificationAttempt.current)clarificationAttempt.current.batchId=result.batchId;
  }

  async function copyBulletin(){
    try{
      await navigator.clipboard.writeText(bulletinForReading(activeBulletin));
      setNotice('Draf disalin ke papan klip. Periksa sebelum dibagikan.');
    }catch{
      setNotice('Clipboard tidak tersedia. Salin teks draf secara manual.');
    }
  }

  function download(){
    const needs=view==='Kebutuhan';
    const content=(storageVerified?'Rekap tersimpan dan terverifikasi':(storedLoaded&&!preview)?'Rekap dibaca dari penyimpanan':'Mode pratinjau — bukan rekap final')+'\n'+recapCsv(rows,needs?metricKey:undefined);
    const url=URL.createObjectURL(new Blob(['\uFEFF'+content],{type:'text/csv;charset=utf-8'}));
    const a=document.createElement('a');
    a.href=url;
    a.download=needs?'SIGAP_kebutuhan.csv':'SIGAP_rekap_posko.csv';
    a.click();
    URL.revokeObjectURL(url);
    setNotice('CSV diunduh sesuai filter aktif.');
  }

  function newReport(){
    setInput('');
    focusComposer.current=true;
    setPage('Laporan');
    if(page==='Laporan'){focusComposer.current=false;composer.current?.focus();}
  }


  return <div className="app-shell">
    <header className="app-header">
      <a className="brand" href="#laporan" onClick={e=>{e.preventDefault();setPage('Laporan')}} aria-label="SIGAP, halaman laporan"><BrandLogo/><span>SIGAP</span></a>
      <nav aria-label="Navigasi utama">{pages.map(name=><button key={name} aria-current={page===name?'page':undefined} className={page===name?'active':''} onClick={()=>setPage(name)}>{name}</button>)}</nav>
      <button className="status-btn" onClick={()=>setModal('connection')} title="Lihat konfigurasi LLM"><span className={`dot ${statusTone}`} aria-hidden="true"/>{statusLabel}</button>
    </header>
    <main className={`page page-${page.toLowerCase()}`}>
      {page==='Laporan'&&<>
        <div className="page-heading">
          <p className="location">Pos Komando Sumedang</p>
          <h1 ref={heading} tabIndex={-1}>Laporan lapangan</h1>
          <p>Tempel laporan di kotak di bawah ini. Hasil pemeriksaan akan tampil di bagian pratinjau untuk Anda tinjau.</p>
        </div>

        <ChatDock messages={messages} input={input} onInput={setInput} onSend={()=>void send()} onUpload={()=>upload.current?.click()} processing={processing} dispatching={dispatching} composerRef={composer} statusText={chatStatus} suggestions={suggestions} onSuggest={text=>{setInput(text);composer.current?.focus();}}/>

        {filename&&<p className="note" role="status">Berkas: {filename} · akan divalidasi sebelum penyimpanan. <button className="text-link" onClick={()=>setFilename(undefined)}>Lepas berkas</button></p>}
        {showReportProgress&&<><ol className="steps" aria-label={batchId?`Progres batch ${batchId}`:'Progres batch'}>
          {steps.map((label,i)=><li key={label} className={i<currentStep?'done':i===currentStep?(processing&&reportInFlight?'current working':'current'):''} aria-current={i===currentStep?'step':undefined}><span className="step-dot">{i<currentStep?<Check size={13} aria-hidden="true"/>:i+1}</span>{label}</li>)}
        </ol>
        <p className="steps-caption" role="status" aria-live="polite">{stepCaption}</p></>}

        <section className="card" aria-labelledby="preview-title">
          <div className="card-head">
            <div><h2 id="preview-title">Pratinjau rekap</h2><p className="muted">{activeRows.length?(!pendingReviews.length&&storedLoaded&&!preview?`${activeRows.length} posko · rekap tersimpan`:`${activeRows.length} posko · versi ${version}`):'Belum ada data'}</p></div>
            <Badge status={pendingReviews.length?'Perubahan belum disimpan':storageVerified?'Tersimpan & terverifikasi':(processing&&reportInFlight&&preview)?'Memperbarui…':preview?'Perlu pemeriksaan':storedLoaded?'Dari penyimpanan':'Belum tersedia'}/>
          </div>
          {!health&&activeRows.length>0&&<p className="note"><Info size={15} aria-hidden="true"/>Mode demo: data di bawah hanyalah contoh dan belum berasal dari laporan Anda.</p>}
          {processing&&reportInFlight&&preview&&<p className="note"><Info size={15} aria-hidden="true"/>Memproses pesan terbaru. Rekap di bawah tetap yang terakhir dan akan diganti jika ada rekap baru.</p>}
          {reviewPicker()}
          {needsCheck>0&&<div className="callout warn"><TriangleAlert size={18} aria-hidden="true"/><p><strong>{needsCheck} posko perlu diperiksa.</strong> Ada konflik angka atau data yang belum lengkap.</p><button className="button quiet" onClick={goReview}>Periksa<ChevronRight size={16} aria-hidden="true"/></button></div>}
          {activeRows.length?<div className="list">
            <div className="list-head" aria-hidden="true"><span>Posko</span><span>Jiwa</span><span>Kebutuhan</span><span>Status</span></div>
            {activeRows.slice(0,5).map(row=><button className="list-row" key={`${row.sourceBatchId||""}:${row.id}:${row.name}:${row.village}`} onClick={()=>setDetail(row)}><span className="cell-name"><strong>{row.name}</strong><small>{row.village}{row.changes?.length?' · belum disimpan':''}</small></span><span className="cell-num">{row.people===null?'—':number(row.people)}</span><span className="cell-needs">{row.needs?.slice(0,2).join(', ') || 'Belum diketahui'}</span><span><Badge status={row.status}/>{!!row.reviewItems?.length&&<span className="review-summary">{reviewSummary(row.reviewItems)}{row.reviewItems.length>2?` · +${row.reviewItems.length-2}`:""}</span>}</span></button>)}
          </div>:<div className="empty"><div className="empty-icon"><FileText size={22} aria-hidden="true"/></div><div><strong>Belum ada kandidat rekap</strong><p>Kirim laporan lewat kotak chat di atas, atau coba dulu dengan laporan contoh.</p></div><button className="button secondary" onClick={loadDemo}>Muat laporan contoh</button></div>}
          {activeRows.length>5&&<button className="text-link" onClick={()=>setPage('Rekap')}>Lihat semua {activeRows.length} posko<ChevronRight size={16} aria-hidden="true"/></button>}
          {processing&&stageText&&<p className="note"><Info size={15} aria-hidden="true"/>{stageText}…</p>}
        </section>
      </>}
      {page==='Rekap'&&<>
        <div className="page-heading heading-row"><div><p className="location">Pemeriksaan laporan</p><h1 ref={heading} tabIndex={-1}>Rekap posko</h1><p>Buka posko untuk melihat sumber dan data terpilah.</p></div><button className="button secondary" onClick={newReport}><Plus size={17} aria-hidden="true"/>Laporan baru</button></div>
        <dl className="stats"><div><dt>Posko</dt><dd>{activeRows.length}</dd></div><div><dt>Perlu klarifikasi</dt><dd>{clarifyCount}</dd></div><div><dt>Parsial</dt><dd>{partialCount}</dd></div></dl>
        {(needsCheck>0||!preview)&&<div className="callout warn"><TriangleAlert size={18} aria-hidden="true"/><p>{preview?<><strong>{needsCheck} posko perlu pemeriksaan.</strong> Periksa sumber dan usulan perubahan sebelum menyetujui.</>:storedLoaded?<><strong>Ini rekap tersimpan.</strong> Dibaca otomatis dari penyimpanan di awal sesi. Kirim laporan baru untuk membuat kandidat yang bisa disetujui.</>:<><strong>Ini rekap contoh.</strong> Belum dianalisis dari laporan Anda. Posko tanpa stok ditandai belum diketahui.</>}</p>{needsCheck>0&&<button className="button quiet" onClick={()=>{setView('Posko');setFilter('Perlu pemeriksaan');setQuery('')}}>Tampilkan<ChevronRight size={16} aria-hidden="true"/></button>}</div>}
        {reviewPicker()}
        <div className="view-switch" role="group" aria-label="Jenis rekap">{(['Posko','Kebutuhan'] as View[]).map(value=><button key={value} aria-pressed={view===value} className={view===value?'selected':''} onClick={()=>setView(value)}>{value}</button>)}</div>
        <div className="toolbar"><label className="search"><Search size={17} aria-hidden="true"/><input aria-label="Cari posko atau desa" placeholder="Cari posko atau desa" value={query} onChange={e=>setQuery(e.target.value)}/></label><select aria-label="Filter status" value={filter} onChange={e=>setFilter(e.target.value)}><option>Semua status</option><option>Perlu pemeriksaan</option><option>Siap ditinjau</option><option>Perlu klarifikasi</option><option>Menunggu persetujuan</option><option>Parsial</option></select><button className="button secondary" onClick={download}><ArrowDownToLine size={16} aria-hidden="true"/>Unduh CSV</button></div>
        {view==='Kebutuhan'&&<label className="metric-select">Jenis kebutuhan<select value={metricKey} onChange={e=>setMetricKey(e.target.value as RequirementKey)}>{metrics.map(m=><option key={m.key} value={m.key}>{m.label}</option>)}</select></label>}
        <section className="recap-table" aria-label={view==='Posko'?'Daftar posko':`Kebutuhan ${metric.label} posko`}><div className="table-scroll"><table>
          <caption className="sr-only">{view==='Posko'?'Rekap posko':`Kebutuhan ${metric.label} (${metric.unit})`}</caption>
          <thead><tr><th scope="col">Posko</th><th scope="col">Kebutuhan dilaporkan</th>{view==='Posko'?<><th scope="col">Jumlah jiwa</th><th scope="col">Status laporan</th></>:<><th scope="col">Kebutuhan {metric.label.toLowerCase()}</th><th scope="col">Kekurangan</th></>}<th scope="col"><span className="sr-only">Detail</span></th></tr></thead>
          <tbody>{rows.map(s=><tr key={`${s.sourceBatchId || ""}:${s.id}:${s.name}:${s.village}`}>
            <td><button className="shelter-link" onClick={()=>setDetail(s)}>{s.name}</button><span className="village">{s.village}{s.changes?.length?' · belum disimpan':''}</span></td>
            <td className="reported-needs">{s.needs.join(', ')||<span className="unknown">Belum dilaporkan</span>}</td>
            {view==='Posko'?<><td className="population">{s.estimate?'≈ ':''}{number(s.people)}{s.estimate&&<span className="village">Estimasi</span>}</td><td className="review-status"><Badge status={s.status}/>{!!s.reviewItems?.length&&<><p className="review-summary">{reviewSummary(s.reviewItems)}</p><button className="review-link" aria-label={`Lihat pemeriksaan ${s.name}`} onClick={()=>setDetail(s)}>Lihat {s.reviewItems.length} hal yang perlu diperiksa</button></>}</td></>:<><td>{quantity(s)}</td><td><span className={metricValue(s,metricKey,true)===null?'unknown':metricValue(s,metricKey,true)===0?'gap-ok':''}>{quantity(s,true)}</span></td></>}
            <td><button className="icon-button" aria-label={`Detail ${s.name}`} onClick={()=>setDetail(s)}><ChevronRight size={19} aria-hidden="true"/></button></td>
          </tr>)}</tbody>
        </table></div>{rows.length===0&&<div className="empty-state"><h2>{activeRows.length?'Tidak ada posko yang cocok dengan filter':'Belum ada data posko'}</h2><p>{activeRows.length?`${activeRows.length} posko tetap tercatat. Coba kata pencarian atau status lain.`:'Kirim laporan untuk membuat pratinjau rekap.'}</p>{activeRows.length>0&&<button className="button secondary" onClick={()=>{setQuery('');setFilter('Semua status')}}>Reset filter</button>}</div>}</section>
        {view==='Kebutuhan'&&<p className="note">Acuan kebutuhan: {metric.basis}. Kekurangan hanya diketahui jika data stok dan waktunya lengkap. Barang yang diminta posko tercantum di kolom “Kebutuhan dilaporkan”.</p>}
        <div className="review-actions"><div><span className="version">{storedLoaded&&!preview?'Rekap tersimpan':`Kandidat versi ${version}`}</span><p>{pendingReviews.length>1?'Pilih kandidat di atas. Setiap kandidat disimpan dengan persetujuan terpisah.':storageVerified?'Tersimpan dan terverifikasi di penyimpanan.':(storedLoaded&&!preview)?'Rekap ini dibaca dari penyimpanan. Belum ada kandidat baru untuk disetujui.':(processing&&reportInFlight&&preview)?'Memproses pesan terbaru. Persetujuan aktif lagi setelah selesai.':saveSubmitted?(health?.mode==='mock_mode'?'Keputusan simulasi tercatat. Tidak ada penulisan nyata.':'Keputusan penyimpanan tercatat. Periksa hasil verifikasi.'):approved?`Simulasi disetujui (${approved.clearDecision}). Belum disimpan ke backend.`:'Rekap parsial. Periksa detail sebelum menyetujui.'}</p></div><button className="button primary" disabled={processing||dispatching||saveSubmitted|| (!!sessionId&&!snapshotId)} onClick={openApproval}><ShieldCheck size={17} aria-hidden="true"/>{storageVerified?'Tersimpan & Terverifikasi':saveSubmitted?'Keputusan tercatat':approved?'Ulangi persetujuan':'Tinjau & setujui'}</button></div>
      </>}
      {page==='Buletin'&&<>
        <div className="page-heading heading-row"><div><p className="location">Komunikasi kebutuhan</p><h1 ref={heading} tabIndex={-1}>Draf buletin donatur</h1><p>Baca dan periksa isi sebelum dibagikan.</p></div><button className="button secondary" onClick={copyBulletin}><Copy size={17} aria-hidden="true"/>Salin draf</button></div>
        <div className="callout"><span className="draft-tag">DRAF</span><p>Belum disetujui untuk publikasi. Pastikan angka berasal dari snapshot yang sama{snapshotId?` (${snapshotId})`:''}, dan label estimasi serta konflik tetap terlihat.</p></div>
        {health&&sessionId&&activeBulletin.startsWith('Belum ada')&&<div className="empty"><div className="empty-icon"><FileText size={22} aria-hidden="true"/></div><div><strong>Draf buletin belum ada</strong><p>{processing?(stageLabel(stage)||'Agent sedang menyusun draf')+'…':'Minta Agent menyusun draf dari rekap yang ada. Hanya pratinjau, tidak ada dokumen yang dibuat.'}</p></div><button className="button secondary" disabled={processing||dispatching} onClick={requestBulletin}>Susun draf</button><button className="button quiet" onClick={()=>setPage('Laporan')}>Lihat jawaban Agent</button></div>}
        <article className="paper" aria-label="Isi draf buletin"><MarkdownContent text={bulletinForReading(activeBulletin)} className="bulletin-markdown" tableLabel="Tabel buletin"/></article>
        <p className="note"><ShieldCheck size={15} aria-hidden="true"/>Tidak ada publikasi otomatis. Keputusan distribusi tetap pada petugas berwenang.</p>
      </>}
      <footer className="page-footer">Data untuk demonstrasi Pos Komando. Keputusan distribusi tetap di tangan pimpinan.</footer>
    </main>
    <input ref={upload} type="file" accept=".txt,.csv,text/plain,text/csv" hidden onChange={e=>{const file=e.target.files?.[0];if(file)void readFile(file);}}/>
    {notice&&<div className="toast" role="status"><Info size={18}/><span>{notice}</span><button className="icon-button" aria-label="Tutup pemberitahuan" onClick={()=>setNotice('')}><X size={18}/></button></div>}
    <dialog ref={dialog} aria-labelledby="dialog-title" className="dialog" onCancel={close} onClick={e=>{if(e.target===dialog.current)close();}}>
      <div className="dialog-heading"><span id="dialog-title">{detail?'Detail laporan':modal==='approve'?'Tinjau persetujuan':'Koneksi & Pengaturan Sesi'}</span><button className="icon-button" aria-label="Tutup dialog" onClick={close}><X size={20}/></button></div>
      {detail&&<div className="dialog-body"><div className="detail-title"><h2>{detail.name}</h2><Badge status={detail.status}/></div><p className="detail-meta">{detail.village} · {detail.id} · {detail.time}</p><dl className="detail-grid">{[['Jumlah jiwa',detail.people],['Laki-laki',detail.male],['Perempuan',detail.female],['Lansia',detail.elderly],['Disabilitas',detail.disability]].map(([label,value])=><div key={String(label)}><dt>{String(label)}</dt><dd>{number(value as number|null)}</dd></div>)}</dl><div className="detail-note"><Info size={18}/><p>{detail.note}</p></div><ReviewChecklist items={detail.reviewItems}/><h3>Kebutuhan yang dilaporkan</h3><p>{detail.needs.length?detail.needs.join(', '):'Belum dilaporkan'}</p><h3>{!health||preview?.simulated?'Sumber laporan sintetis':'Rujukan sumber'}</h3><blockquote>{detail.source}</blockquote>{detail.requirements&&<section aria-label="Hasil perhitungan kebutuhan"><h3>Kebutuhan hasil perhitungan</h3><dl className="detail-grid">{metrics.map(item=>{const value=metricValue(detail,item.key);return <div key={item.key}><dt>{item.label}</dt><dd>{value===null?'Belum diketahui':`${number(value)} ${item.unit}`}</dd></div>;})}</dl></section>}{reviewForShelter(pendingReviews,detail)&&<section aria-label="Penyimpanan perubahan"><p>Angka di pratinjau belum menggantikan rekap tersimpan. Tinjau keputusan dan setujui untuk menyimpan.</p><button className="button primary" disabled={processing||dispatching||submittedReviews.current.has(reviewForShelter(pendingReviews,detail)?.batchId||'')} onClick={()=>openShelterApproval(detail)}>Tinjau &amp; simpan perubahan</button></section>}<ClarificationForm shelter={detail} busy={processing||dispatching} connected={!!health&&!!sessionId} feedback={clarificationFeedback} onSubmit={clarify}/></div>}
      {modal==='approve'&&<div className="dialog-body"><h2>Setujui rekap parsial?</h2>{preview&&<p className="approval-scope"><strong>Kandidat yang disetujui:</strong> {reviewLabel({batchId:candidateBatchId,preview})}. Kandidat lain menunggu persetujuan terpisah.</p>}<p>Pratinjau versi {reviewedVersion} memuat konflik angka dan data yang belum lengkap. Penulisan ke penyimpanan eksternal hanya dilakukan setelah konfirmasi eksplisit.</p>{preview?pendingFields.map(p=><label className="field-label" key={p.reportId+':'+p.field}>{p.reportId} · {p.field}<select aria-label={`Keputusan ${p.reportId} ${p.field}`} value={clearChoices[p.reportId]?.[p.field]||''} onChange={e=>setClearChoices(c=>({...c,[p.reportId]:{...c[p.reportId],[p.field]:e.target.value as ClearDecision}}))}><option value="">Pilih keputusan</option><option value="clear">Kosongkan nilai</option><option value="keep">Pertahankan nilai</option><option value="defer">Tunda keputusan</option></select></label>):<label className="field-label">Data disabilitas lama Posko Harapan<select aria-label="Keputusan pengosongan disabilitas" value={decision} onChange={e=>setDecision(e.target.value as ClearDecision)}><option value="">Pilih keputusan</option><option value="clear">Kosongkan data lama</option><option value="keep">Pertahankan data lama</option><option value="defer">Tunda keputusan</option></select></label>}<ConflictReview preview={preview} choices={conflictChoices} onChange={setConflictChoices}/><label className="checkbox-row"><input type="checkbox" checked={partial} onChange={e=>setPartial(e.target.checked)}/><span>Saya memahami rekap masih parsial dan konflik belum selesai.</span></label><label className="checkbox-row"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/><span>Saya menyetujui keputusan penyimpanan atas pratinjau versi {reviewedVersion}.</span></label>{error&&<p className="form-error" role="alert">{error}</p>}<div className="dialog-actions"><button className="button secondary" onClick={close}>Kembali periksa</button><button className="button primary" onClick={approve}>Konfirmasi persetujuan<Check size={16}/></button></div></div>}
      {modal==='connection'&&<div className="dialog-body"><h2>Konfigurasi LLM</h2><p>Status Backend: <strong>{health ? health.backend : 'Tidak terhubung (Mode Demo)'}</strong></p><p>LLM / Agent: <strong>{health?.model|| (health?.agent==='gemini'?'Gemini':health?.agent==='openai'?'DeepSeek':health?.agent==='mock'?'Simulasi lokal':health?.agent?'Agent':'Belum terhubung')}</strong>. Status koneksi menunjukkan konfigurasi; hasil nyata diperiksa lewat workflow.</p><p>Mode Operasi: <strong>{health ? health.mode : 'Demo lokal'}</strong></p><div className="dialog-actions"><button className="button secondary" onClick={close}>Tutup</button></div></div>}
    </dialog>
  </div>;
}
