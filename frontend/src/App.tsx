import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, Check, ChevronRight, Copy, FileText, Info, Plus, Search, ShieldCheck, TriangleAlert, X, Home, Users, Droplets, RotateCw, AlertCircle } from 'lucide-react';
import { shelters, sampleReport, bulletin, type Shelter, type RequirementKey } from './demo';
import { approveDemoReview, validateReportFile, isOcrDocument, type ClearDecision } from './review';
import { checkBackendHealth, createBackendSession, sendBackendMessage, submitBatchDecision, ensureSessionToken, extractReportDocument, authenticatedRequest, HttpResponseError, type DocumentExtraction, type HealthResponse } from './api';
import { connectEventStream } from './stream';
import { previewRows, storedRows, pendingClearFields, matchesClarificationTarget, type Preview } from './backendPreview';
import { receiveReview, pendingRows, reviewForShelter, reviewLabel, applyReviewCalculations, type PendingReview } from './pendingReviews';
import { ChatDock } from './ChatDock';
import { ChangeSummary } from './ChangeSummary';
import { TasksView } from './TasksView';
import { useWorkspaceNavigation, pages } from './useWorkspaceNavigation';
import { useActivityClock } from './useActivityClock';
import { useReviewWorkspace } from './useReviewWorkspace';
import { useBulletinSource } from './useBulletinSource';
import { stableShelterKey, qualityLabel, tasksFor, sourceFingerprint } from './presentation';
const LaporanView = lazy(() => import('./LaporanView').then(m => ({ default: m.LaporanView })));
const ClarificationPage = lazy(() => import('./ClarificationPage').then(m => ({ default: m.ClarificationPage })));
const BuletinView = lazy(() => import('./BuletinView').then(m => ({ default: m.BuletinView })));
const RekapView = lazy(() => import('./RekapView').then(m => ({ default: m.RekapView })));
import { BrandLogo } from './BrandLogo';
import { MarkdownContent } from './MarkdownContent';
import { bulletinForReading, hasBulletinContent } from './bulletin';
import { reviewSummary } from './reviewIndicators';
import { ClarificationForm, clarificationApplied, type ClarificationFeedback, type ClarificationChanges } from './ClarificationForm';
import { ConflictReview, storageConflicts, type ConflictChoices } from './ConflictReview';
import { stageLabel, isReportStage, isReadOnlyStage } from './stageLabels';

import { metricValue, metrics, recapCsv } from './needs';
import type { RekapFocus } from './chartData';
import { NeedSummaryCard, PrioritySheltersCard } from './NeedSummary';

type View = 'Posko' | 'Kebutuhan';
const number = (value: number | null) => value === null ? 'Belum diketahui' : new Intl.NumberFormat('id-ID').format(value);
const steps = ['Input', 'Proses', 'Tinjau', 'Simpan'];
function Badge({ status }: { status: string }) { const tone = ['Perlu klarifikasi', 'Menunggu persetujuan'].includes(status) ? 'warning' : ['Parsial', 'Data belum lengkap', 'Belum tersedia', 'Memperbarui…', 'Dari penyimpanan'].includes(status) ? 'neutral' : 'success'; return <span className={`badge ${tone}`}><span />{status}</span> }

export default function App({ contextId = 'posko-sumedang', operator = 'Operator', onLogout, preferenceKey = 'local', role = 'petugas' }: { contextId?: string; operator?: string; onLogout?: () => void; preferenceKey?: string; role?: 'admin' | 'petugas' } = {}) {
  const [page, setPage, detailKey, backFromClarification] = useWorkspaceNavigation();
  const [visited, setVisited] = useState<string[]>([page]);
  useEffect(() => setVisited(v => v.includes(page) ? v : [...v, page]), [page]);
  const [clarificationField, setClarificationField] = useState<string | undefined>();
  const [view, setView] = useState<View>('Posko');
  const [rekapFocus, setRekapFocus] = useState<(RekapFocus & { requestId: number }) | null>(null);
  const [metricKey, setMetricKey] = useState<RequirementKey>('air_liter_per_hari');
  const metric = metrics.find(m => m.key === metricKey)!;
  const quantity = (row: Shelter, shortage = false) => { const v = metricValue(row, metricKey, shortage); return v === null ? 'Belum diketahui' : `${!shortage && row.estimate ? '≈ ' : ''}${number(v)} ${metric.unit}`; };
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('Semua status');
  const [input, setInput] = useState('');
  const [filename, setFilename] = useState<string | undefined>();
  const [documentBusy, setDocumentBusy] = useState(false);
  const [originalDocument, setOriginalDocument] = useState<File | null>(null);
  const [documentReview, setDocumentReview] = useState<DocumentExtraction | null>(null);
  const documentTask = useRef<AbortController | null>(null);
  useEffect(() => () => { documentTask.current?.abort(); }, []);
  const [conflictChoices, setConflictChoices] = useState<ConflictChoices>({});
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; text: string }[]>([]);
  const [detail, setDetail] = useState<Shelter | null>(null);
  const detailBinding = useRef<string | null>(null);
  const [focusRevision, setFocusRevision] = useState(0);
  const [modal, setModal] = useState<'approve' | 'connection' | null>(null);
  const [version, setVersion] = useState(1);
  const [reviewedVersion, setReviewedVersion] = useState(1);
  const [confirmed, setConfirmed] = useState(false);
  const [partial, setPartial] = useState(false);
  const [decision, setDecision] = useState<ClearDecision>('');
  const [approved, setApproved] = useState<ReturnType<typeof approveDemoReview> | null>(null);
  const [notice, setNotice] = useState('');
  const [operationError, setOperationError] = useState('');
  const [error, setError] = useState('');
  const [clarificationFeedback, setClarificationFeedback] = useState<ClarificationFeedback>(null);
  const clarificationAttempt = useRef<{ shelter: Shelter; expected: ClarificationChanges; batchId?: string; received: boolean } | null>(null);

  // Backend live integration state
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [sessionId, setSessionId] = useState<string>('');
  const [batchId, setBatchId] = useState<string>('');
  const [snapshotId, setSnapshotId] = useState<string>('');
  const [processing, setProcessing] = useState<boolean>(false);
  const bulletinSource = useBulletinSource();
  const markSaveUnverified = (batch?: string) => setSaveOutcomes(current => Object.fromEntries(Object.entries(current).map(([id, value]) => [id, value === 'Menyimpan' && (!batch || batch === id) ? 'Hasil simpan belum terverifikasi' : value])));
  const [dispatching, setDispatching] = useState(false);
  const elapsed = useActivityClock(processing || dispatching);
  const [saveOutcomes, setSaveOutcomes] = useState<Record<string, string>>({});
  const dispatchInFlight = useRef(false);
  const previewRevision = useRef(0);
  const workspaceRevision = useRef(0);
  const completionRevision = useRef(0);
  const [stage, setStage] = useState<string>('');
  const { activeRows, setActiveRows, pendingReviews, setPendingReviews, pendingReviewRef, storedBase, rowsRef } = useReviewWorkspace();
  const [bulletinBatchId, setBulletinBatchId] = useState('');
  const [activeBulletin, setActiveBulletin] = useState<string>('Belum ada draf dari server.');
  const [storageVerified, setStorageVerified] = useState<boolean>(false);
  const [preview, setPreview] = useState<Preview | null>(null);


  const submittedReviews = useRef(new Set<string>());
  const [clearChoices, setClearChoices] = useState<Record<string, Record<string, ClearDecision>>>({});
  const [saveSubmitted, setSaveSubmitted] = useState(false);
  // Rekap yang dibaca otomatis dari penyimpanan pada pesan pertama. Bukan kandidat, jadi tidak bisa disetujui.
  const [storedLoaded, setStoredLoaded] = useState(false);
  const [overviewStatus, setOverviewStatus] = useState<'' | 'loading' | 'error'>('');
  const [overviewReload, setOverviewReload] = useState(0);
  const [bootstrapReload, setBootstrapReload] = useState(0);
  const overviewAttempt = useRef('');
  // Alur laporan (ekstrak/validasi/simpan) sedang berjalan. Chat biasa tidak menggerakkan indikator langkah.
  const [reportInFlight, setReportInFlight] = useState(false);
  const [activity, setActivity] = useState<'chat' | 'read' | 'report'>('chat');
  const candidateRef = useRef('');
  // Rekap tersimpan sebagai dasar: kandidat (mis. koreksi satu posko) digabung ke sini, tidak menggantikannya.


  // Batch milik rekap yang sedang ditinjau. Terpisah dari batch pesan terbaru, supaya chat lanjutan
  // tidak menimpa pasangan batch+snapshot yang masih bisa disetujui.
  const [candidateBatchId, setCandidateBatchId] = useState<string>('');
  const latestBatch = useRef('');
  const recoveryCursor = useRef(0);
  useEffect(() => { candidateRef.current = candidateBatchId; }, [candidateBatchId]);
  // Waktu & jenis event terakhir dari server, dipakai untuk mendeteksi giliran yang sudah selesai.
  const lastEvent = useRef<{ type: string; at: number }>({ type: '', at: 0 });
  const tracked = (h: Record<string, (d: any) => void>) => Object.fromEntries(Object.entries(h).map(([k, fn]) => [k, (d: any) => { lastEvent.current = { type: k, at: Date.now() }; fn(d); }]));

  const pendingFields = preview ? pendingClearFields(preview) : [];
  const needsPartial = !!preview && (preview.issues?.length || preview.records?.some(r => r.missing_fields?.length || r.validation_issues?.length || r.pending_clear_fields?.length || r.unverified_numbers?.length || r.storage_conflicts?.length));

  const upload = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const focusComposer = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const previousPage = useRef(page);
  const inactiveHeading = useRef<HTMLHeadingElement>(null);

  // Initialize and check backend connection
  useEffect(() => {
    let active = true; setOverviewStatus('loading');
    checkBackendHealth().then(h => {
      if (h && active) {
        setHealth(h);
        createBackendSession(contextId).then(async s => {
          if (!active) return;
          {
            const state = await authenticatedRequest(`/api/sessions/${s.session_id}/recovery`);
            if (!active) return;
            const reviews: PendingReview[] = state.reviews || [];
            pendingReviewRef.current = reviews; setPendingReviews(reviews);
            storedBase.current = storedRows(state.records || []);
            let recovered = pendingRows(storedBase.current, reviews);
            for (const review of state.reviews || []) if (review.gap) recovered = applyReviewCalculations(recovered, reviews, { ...review.gap, batch_id: review.batchId });
            setActiveRows(recovered); setStoredLoaded(!reviews.length && storedBase.current.length > 0);
            activateReview(reviews.at(-1) || null);
            recoveryCursor.current = state.after_event_id || 0;
            if (state.active_batch) { latestBatch.current = state.active_batch; setProcessing(true); }
            setNotice(reviews.length ? `${reviews.length} draf perubahan dipulihkan dari database. Periksa sebelum menyimpan.` : 'Rekap tersimpan dimuat dari database.');
          }
          setOperationError(''); setSessionId(s.session_id); setActiveBulletin('Belum ada draf dari server.');
        }).catch(err => { if (active) { setOperationError(err.message); setOverviewStatus('error'); } });
      } else if (active) setOverviewStatus('error');
    });
    return () => { active = false; };
  }, [bootstrapReload]);

  // Fetch streaming supports Bearer headers and Last-Event-ID replay.
  useEffect(() => {
    if (!sessionId) return;
    const stream = connectEventStream(`/api/sessions/${sessionId}/events`, () => ensureSessionToken(), tracked({
      stage_changed: data => {
        const attempt = clarificationAttempt.current;
        if (attempt && !attempt.batchId) attempt.batchId = data.batch_id;
        setStage(data.stage || '');
        if (isReportStage(data.stage)) { setReportInFlight(true); setActivity('report'); }
        else if (isReadOnlyStage(data.stage)) setActivity(previous => previous === 'report' ? 'report' : 'read');
        if (attempt?.received && attempt.batchId === data.batch_id) {
          if (data.stage === 'recalculate_correction') setClarificationFeedback(previous => previous?.kind === 'success' ? { kind: 'pending', text: 'Kandidat baru diterima. Menghitung ulang kebutuhan…' } : previous);
          if (data.stage === 'recalculation_failed') setClarificationFeedback(previous => previous?.kind === 'pending' ? { kind: 'success', text: data.message } : previous);
        }
      },
      // Server menandai operasi selesai. Tanpa ini, indikator "memproses" baru mati setelah jeda diam beberapa detik.
      processing_completed: data => {
        if (data.batch_id && data.batch_id !== latestBatch.current && data.batch_id !== candidateRef.current && data.batch_id !== clarificationAttempt.current?.batchId) return;
        completionRevision.current++; setProcessing(false); setReportInFlight(false); setStage('');
        if (clarificationAttempt.current && (!data.batch_id || data.batch_id === clarificationAttempt.current.batchId)) {
          if (!clarificationAttempt.current.received) failClarification('Belum ada kandidat perubahan yang tervalidasi. Periksa atau kirim ulang klarifikasi.');
          clarificationAttempt.current = null;
        }
      },
      assistant_message: data => { if (data.chunk || data.text) setMessages(m => [...m, { role: 'assistant', text: data.chunk || data.text }]); },
      preview_ready: data => {
        setActivity('report');
        workspaceRevision.current++;
        previewRevision.current++;
        setStoredLoaded(false);
        const review = { batchId: data.batch_id || latestBatch.current, preview: data };
        pendingReviewRef.current = receiveReview(pendingReviewRef.current, review);
        setPendingReviews(pendingReviewRef.current);
        activateReview(review);
        const candidateRows = previewRows(data);
        const merged = pendingRows(storedBase.current, pendingReviewRef.current, rowsRef.current);
        setActiveRows(merged);
        const attempt = clarificationAttempt.current;
        if (attempt && (!attempt.batchId || attempt.batchId === data.batch_id)) {
          attempt.batchId = data.batch_id;
          const matches = candidateRows.filter(row => matchesClarificationTarget(row, attempt.shelter));
          if (matches.length === 1) {
            attempt.received = true;
            const updated = merged.find(row => matchesClarificationTarget(row, attempt.shelter)) || matches[0];
            setDetail(current => current ? updated : null);
            const applied = clarificationApplied(matches[0], attempt.expected);
            if (!applied) failClarification('Kandidat baru belum menerapkan seluruh data yang diminta. Periksa hasil validasi; isian koreksi dipertahankan untuk diperiksa atau dikirim ulang.');
            else setClarificationFeedback({ kind: 'success', text: data.simulated ? 'Pratinjau sintetis diterima dari backend mock. Periksa angka hasil simulasi; belum ada penyimpanan nyata.' : 'Kandidat baru diterima. Periksa angka hasil validasi di sini; perubahan belum disimpan.' });
          } else failClarification('Hasil validasi belum memuat satu posko yang sesuai. Periksa target klarifikasi sebelum melanjutkan.');
        }
        setVersion(v => v + 1); setClearChoices({}); setConflictChoices({}); setSaveSubmitted(false); setStorageVerified(false);
        setActiveBulletin(current => hasBulletinContent(current) ? current : 'Belum ada draf buletin untuk kandidat ini.');
        setNotice(data.simulated ? 'Pratinjau sintetis dari backend mock tersedia.' : 'Kandidat baru tersedia. Perubahan posko lain yang belum disimpan tetap ditampilkan.');
      },
      stored_rekap_ready: data => {
        workspaceRevision.current++;
        const rows = storedRows(data.records || []);
        storedBase.current = rows;
        setActiveRows(pendingRows(rows, pendingReviewRef.current, rowsRef.current));
        setStoredLoaded(!pendingReviewRef.current.length && rows.length > 0);
        setNotice('Rekap tersimpan dimuat otomatis dari penyimpanan.');
      },
      approval_required: () => { completionRevision.current++; setProcessing(false); },
      storage_result: data => setNotice(data.simulated ? 'Simulasi write sedang diperiksa.' : 'Data rekap sedang diverifikasi ke penyimpanan...'),
      readback_result: data => {
        if (data.batch_id) setSaveOutcomes(v => ({ ...v, [data.batch_id]: data.verification_status === 'verified' && !data.simulated ? 'Tersimpan dan terverifikasi' : 'Hasil simpan belum terverifikasi' }));
        setActivity('read');
        completionRevision.current++;
        const verified = data.verification_status === 'verified' && !data.simulated;
        setStorageVerified(verified); setProcessing(false);
        if (verified && !data.simulated) {
          const persisted = storedRows(data.records || []);
          if (persisted.length) storedBase.current = persisted;
          const committedBatch = data.batch_id;
          pendingReviewRef.current = pendingReviewRef.current.filter(review => review.batchId !== committedBatch);
          submittedReviews.current.delete(committedBatch);
          setPendingReviews(pendingReviewRef.current);
          setActiveRows(pendingRows(storedBase.current, pendingReviewRef.current, rowsRef.current));
          activateReview(pendingReviewRef.current.at(-1) || null);
          setStoredLoaded(!pendingReviewRef.current.length);
          setStorageVerified(!pendingReviewRef.current.length);
          setFilter('Semua status');
        }
        setNotice(data.simulated ? 'Simulasi penyimpanan selesai. Tidak ada data ditulis ke penyimpanan nyata.' : verified ? 'Tersimpan dan terverifikasi di penyimpanan.' : 'Verifikasi read-back belum sesuai. Tinjau perbedaan sebelum melanjutkan.');
      },
      calculation_ready: data => {
        workspaceRevision.current++;
        setActiveRows(rows => applyReviewCalculations(rows, pendingReviewRef.current, data));
        setDetail(current => current ? applyReviewCalculations([current], pendingReviewRef.current, data)[0] : null);
        const attempt = clarificationAttempt.current;
        if (data.automatic_recalculation && attempt?.received && attempt.batchId === data.batch_id) setClarificationFeedback(previous => previous?.kind !== 'error' ? { kind: 'success', text: 'Kandidat baru diterima. Kebutuhan sudah dihitung ulang; perubahan belum disimpan.' } : previous);
      },
      bulletin_ready: data => { if (data.content) { setActiveBulletin(data.content); setBulletinBatchId(data.batch_id || ''); bulletinSource.receive(data, rowsRef.current); } },
      error: data => { markSaveUnverified(data.batch_id); completionRevision.current++; setProcessing(false); const message = data.message || 'Proses belum dapat diverifikasi.'; setOperationError(message); failClarification(message, data.batch_id); }
    }), err => { markSaveUnverified(); completionRevision.current++; setProcessing(false); setOperationError(err.message + ' Periksa hasil proses sebelum mengirim ulang.'); failClarification(err.message); }, recoveryCursor.current);
    return () => stream.close();
  }, [sessionId]);

  // Initial read/calculation is separate from chat and guarded against newer user work.
  useEffect(() => {
    if (!sessionId) return;
    if (processing) { setOverviewStatus(current => current === 'loading' ? '' : current); return; }
    const attempt = `${sessionId}:${overviewReload}`;
    if (overviewAttempt.current === attempt) return;
    let active = true; const controller = new AbortController();
    queueMicrotask(async () => {
      if (!active) return;
      overviewAttempt.current = attempt; const revision = workspaceRevision.current;
      setOverviewStatus('loading');
      try {
        const data = await authenticatedRequest(`/api/sessions/${sessionId}/overview`, { signal: controller.signal });
        if (!active) return;
        if (revision !== workspaceRevision.current) { setOverviewStatus(''); return; }
        if (data.status === 'busy') { setOverviewStatus('error'); return; }
        if (data.status === 'unavailable') { setOverviewStatus(health?.mode === 'mock_mode' ? '' : 'error'); return; }
        if (Array.isArray(data.records)) {
          storedBase.current = storedRows(data.records);
          let rows = pendingRows(storedBase.current, pendingReviewRef.current, rowsRef.current);
          if (data.calculation) rows = applyReviewCalculations(rows, pendingReviewRef.current, data.calculation);
          setActiveRows(rows); setStoredLoaded(!pendingReviewRef.current.length);
        }
        setOverviewStatus(data.status === 'partial' ? 'error' : '');
      } catch (error) { if (active && !controller.signal.aborted) setOverviewStatus('error'); }
    });
    return () => { active = false; controller.abort(); };
  }, [sessionId, overviewReload, processing]);

  // Pengaman agar "memproses" tidak tersangkut: chat biasa tidak mengirim sinyal selesai dari server.
  useEffect(() => {
    if (!processing) return;
    const timer = setInterval(() => {
      const { type, at } = lastEvent.current, idle = Date.now() - at;
      if ((type === 'assistant_message' && idle > 6000) || idle > 330000) {
        completionRevision.current++; setProcessing(false);
        failClarification('Validasi belum selesai. Perubahan belum diterapkan. Periksa koneksi sebelum mengirim ulang.');
        if (type !== 'assistant_message') { markSaveUnverified(); setOperationError('Hasil proses belum terkonfirmasi. Periksa rekap tersimpan sebelum mengirim ulang.'); }
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [processing]);

  useEffect(() => { if (modal) dialog.current?.showModal(); else dialog.current?.close(); }, [modal]);
  useEffect(() => {
    if (page !== 'Klarifikasi' || !detailKey) return;
    if (detailBinding.current !== detailKey || !detail) {
      const row = activeRows.find(s => stableShelterKey(s) === detailKey);
      if (detailBinding.current !== detailKey) { setClarificationField(undefined); setClarificationFeedback(null); }
      detailBinding.current = detailKey;
      setDetail(row || null);
    }
  }, [page, detailKey, activeRows, detail]);
  useEffect(() => { if (previousPage.current !== page) { previousPage.current = page; heading.current?.focus(); } if (page === 'Laporan' && focusComposer.current) { focusComposer.current = false; composer.current?.focus(); } }, [page, detail]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 5000); return () => clearTimeout(timer); }, [notice]);

  const rows = activeRows.filter(s => `${s.name} ${s.village}`.toLowerCase().includes(query.toLowerCase()) && (filter === 'Semua status' || (filter === 'Perlu pemeriksaan' ? s.status !== 'Siap ditinjau' : s.status === filter)));

  const needsCheck = activeRows.filter(r => r.status !== 'Siap ditinjau').length;
  const clarifyCount = activeRows.filter(r => r.status === 'Perlu klarifikasi').length;
  const partialCount = activeRows.filter(r => r.status === 'Parsial').length;
  const totalPeople = activeRows.reduce((acc, s) => acc + (s.people || 0), 0);
  const gapCount = activeRows.filter(s => metricValue(s, 'air_liter_per_hari', true) !== null && metricValue(s, 'air_liter_per_hari', true)! > 0).length || clarifyCount;
  // Progres mengikuti keadaan nyata: tidak mundur saat pesan lanjutan, dan tidak pura-pura "proses" di mode demo.
  const currentStep = processing && reportInFlight && !preview ? 1 : storageVerified ? 4 : (saveSubmitted || approved) ? 3 : preview ? 2 : 0;
  const showReportProgress = activity === 'report' && !!(processing || preview || (!storageVerified && (saveSubmitted || approved)));
  const stageText = stageLabel(stage);
  const chatStatus = processing ? `${stageText || (reportInFlight ? 'Memeriksa laporan' : 'Agent sedang menjawab')} · ${elapsed} detik` : '';
  const stepCaption = processing && reportInFlight && !preview ? (stageText || 'Memproses laporan…') : storageVerified ? 'Rekap tersimpan.'
    : saveSubmitted ? 'Keputusan tercatat. Menunggu hasil verifikasi.'
      : preview ? 'Hasil pemeriksaan tersedia. Periksa perubahan sebelum menyetujui penyimpanan.'
        : (processing && reportInFlight) ? (stageText || 'Memproses laporan…')
          : 'Menunggu hasil pemeriksaan laporan.';
  const suggestions = [
    { label: 'Cek rekap tersimpan', text: 'Tolong cek rekap posko yang sudah tersimpan dan ringkas isinya.' },
    { label: 'Pakai laporan contoh', text: sampleReport },
    { label: 'Posko mana yang butuh air?', text: 'Posko mana saja yang paling butuh air bersih saat ini?' }
  ];
  const statusTone = !health ? 'demo' : health.mode === 'live' ? 'online' : 'warn';
  const statusLabel = health ? (health.mode === 'mock_mode' ? 'Backend Mock' : ['gemini', 'openai'].includes(health.agent || '') ? (health.mode === 'live' ? 'LLM dikonfigurasi' : 'LLM belum siap') : health.mode === 'live' ? 'Agent tersedia' : 'Koneksi bermasalah') : 'Mode demo';
  function goReview() { setView('Posko'); setFilter('Perlu pemeriksaan'); setQuery(''); setPage('Rekap'); }

  function close() { dialog.current?.close(); setModal(null); setError(''); }
  function focusClarification(field: string) { setClarificationField(field); setFocusRevision(n => n + 1); }
  function openDetail(s: Shelter, field?: string) {
    const key = stableShelterKey(s); detailBinding.current = key; setDetail(s); setClarificationFeedback(null);
    setClarificationField(field); setFocusRevision(n => n + 1);
    setPage('Klarifikasi', { shelterKey: key, replace: page === 'Klarifikasi' });
  }
  function openTask(s: Shelter, action: string) { setClarificationFeedback(null); if (action === 'Tinjau perubahan' && reviewForShelter(pendingReviewRef.current, s)) { openShelterApproval(s); return; } const issue = s.reviewItems?.find(i => action === 'Lengkapi data' ? i.kind === 'missing' : action === 'Tinjau perubahan' ? i.kind === 'decision' : i.kind === 'clarification'); const field = issue?.field || 'stock'; openDetail(s, field); }
  function storageLabel(s: Shelter) { const owner = reviewForShelter(pendingReviews, s); if (owner) return saveOutcomes[owner.batchId] || 'Menunggu persetujuan'; return storedBase.current.some(old => matchesClarificationTarget(s, old)) ? 'Rekap tersimpan' : 'Belum disimpan'; }

  function failClarification(message: string, batch?: string) {
    const attempt = clarificationAttempt.current;
    if (!attempt || (batch && attempt.batchId && attempt.batchId !== batch)) return;
    setClarificationFeedback({ kind: 'error', text: message }); clarificationAttempt.current = null;
  }

  function loadDemo() {
    setInput(sampleReport);
    setVersion(v => v + 1);
    setApproved(null);
    setNotice('Contoh laporan dimuat. Anda dapat membaca laporan atau membuka rekap demo.');
    composer.current?.focus();
  }

  async function send(override?: string, correction?: unknown): Promise<{ ok: boolean; message?: string; batchId?: string }> {
    const raw = override ?? input;
    if (!raw.trim() || processing || dispatchInFlight.current || documentTask.current) return { ok: false, message: 'Tunggu proses yang sedang berjalan sebelum mengirim perubahan.' };
    const textToSend = raw.trim();
    setOperationError('');

    if (!health || !sessionId) {
      // Demo mode fallback
      setInput(''); setApproved(null); setVersion(v => v + 1);
      setMessages(m => [...m, { role: 'user', text: textToSend }, { role: 'assistant', text: 'Pesan diterima di sesi lokal. Agen belum terhubung, jadi laporan ini belum dianalisis. Anda dapat meninjau rekap contoh untuk mencoba alur pemeriksaan.' }]);
      return { ok: true };
    }

    // Live mode backend dispatch
    workspaceRevision.current++;
    const previousPreviewRevision = previewRevision.current;
    const previousWorkspaceRevision = workspaceRevision.current;
    dispatchInFlight.current = true; setDispatching(true);
    lastEvent.current = { type: 'sent', at: Date.now() };
    setProcessing(true); setReportInFlight(false); setActivity('chat'); setStage('');
    const sentMessage: { role: 'user'; text: string } = { role: 'user', text: textToSend };
    setMessages(m => [...m, sentMessage]);
    if (override === undefined) setInput(current => current.trim() === textToSend ? '' : current);
    try {
      const res = await sendBackendMessage(sessionId, textToSend, override === undefined ? filename : undefined, correction);
      setBatchId(res.batch_id);
      if (override === undefined) setFilename(undefined);
      setApproved(null);
      // A fast SSE preview may precede the HTTP response. Preserve that candidate.
      latestBatch.current = res.batch_id;
      if (previewRevision.current === previousPreviewRevision && !pendingReviewRef.current.length && !preview && !storedLoaded && workspaceRevision.current === previousWorkspaceRevision) {
        // Belum ada rekap sama sekali: mulai bersih. Jika sudah ada, rekap lama dipertahankan
        // sampai rekap baru tiba, jadi pesan lanjutan tidak menghapus pekerjaan.
        setVersion(v => v + 1); setStorageVerified(false);
        setSnapshotId(''); setSaveSubmitted(false);
        setActiveRows([]); setActiveBulletin('Belum ada draf buletin untuk laporan ini.');
      }
      if (res.pii_summary?.totalRedacted > 0) {
        setNotice(`${res.pii_summary.totalRedacted} pola data pribadi disaring secara otomatis.`);
      }
      return { ok: true, batchId: res.batch_id };
    } catch (err: any) {
      setProcessing(false);
      setMessages(m => m.filter(message => message !== sentMessage));
      if (override === undefined) setInput(current => current || raw);
      setOperationError(err?.message || 'Gagal mengirim laporan ke backend.');
      return { ok: false, message: err?.message || 'Gagal mengirim laporan ke backend.' };
    } finally {
      dispatchInFlight.current = false; setDispatching(false);
    }
  }

  async function readFile(file: File) {
    if (documentTask.current || processing || dispatchInFlight.current) return;
    try {
      validateReportFile(file.name, file.size);
      if (isOcrDocument(file.name)) {
        if (!health || !sessionId) throw new Error('Hubungkan backend dan masuk ke ruang operasi untuk membaca dokumen dengan OCR.');
        const controller = new AbortController(); documentTask.current = controller; setDocumentBusy(true); setDocumentReview(null); setOriginalDocument(null); setOperationError('');
        const timer = window.setTimeout(() => controller.abort('timeout'), 95000);
        try { const result = await extractReportDocument(sessionId, file, controller.signal); if (!controller.signal.aborted) { setOriginalDocument(file); setDocumentReview(result); } }
        catch (e) { if (controller.signal.aborted) { if (controller.signal.reason === 'timeout') setOperationError('Pembacaan dokumen melewati batas waktu. Coba berkas lebih kecil atau unggah kembali.'); } else throw e; }
        finally { clearTimeout(timer); if (documentTask.current === controller) { documentTask.current = null; setDocumentBusy(false); } }
        return;
      }
      const bytes = await file.arrayBuffer();
      let text: string;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new Error('Berkas tidak dapat dibaca sebagai UTF-8. Simpan ulang sebagai teks UTF-8 atau CSV UTF-8, lalu unggah kembali.'); }
      if (!text.trim()) throw new Error('Laporan kosong. Pilih file dengan isi laporan.');
      setInput(text);
      setOperationError('');
      setFilename(file.name);
      setNotice(`${file.name} dimuat. Laporan belum dikirim.`);
      composer.current?.focus();
    } catch (e) {
      setOperationError(e instanceof Error ? e.message : 'File tidak dapat dibaca.');
    } finally {
      if (upload.current) upload.current.value = '';
    }
  }

  function cancelDocument() { documentTask.current?.abort(); setDocumentReview(null); setOriginalDocument(null); }
  function useDocument(text: string) {
    if (!documentReview || !text.trim() || processing || dispatching) return;
    if (filename?.toLowerCase().endsWith('.csv') && input.trim()) { setOperationError('Laporan CSV masih aktif. Kirim atau bersihkan CSV terlebih dahulu sebelum menggunakan hasil OCR.'); return; }
    const combined = input.trim() ? `${input.trimEnd()}\n\n${text.trim()}` : text.trim();
    if (new TextEncoder().encode(combined).length > 204800) { setOperationError('Gabungan laporan melebihi 200 KiB. Kurangi teks atau kirim sebagai beberapa laporan.'); return; }
    setInput(combined); setFilename(`${documentReview.filename}.ocr.txt`); setDocumentReview(null); setOriginalDocument(null); setOperationError(''); setNotice('Teks OCR dimuat. Periksa laporan lalu tekan Kirim jika sudah sesuai.'); composer.current?.focus();
  }

  // Minta Agent menyusun draf dari halaman Buletin. Hasil tiba lewat SSE (bulletin_ready); hanya pratinjau.
  function requestBulletin() {
    void send('Tolong susun draf buletin donatur dari rekap yang ada saat ini. Hanya pratinjau (action preview), jangan membuat dokumen.');
  }

  function activateReview(review: PendingReview | null) {
    candidateRef.current = review?.batchId || '';
    setCandidateBatchId(review?.batchId || '');
    setPreview(review?.preview || null);
    setSnapshotId(review?.preview.snapshot_id || '');
    setSaveSubmitted(!!review && submittedReviews.current.has(review.batchId));
    setConfirmed(false); setPartial(false); setDecision(''); setClearChoices({}); setConflictChoices({}); setError('');
    if (review) setStorageVerified(false);
  }

  function openShelterApproval(shelter: Shelter) {
    const owner = reviewForShelter(pendingReviewRef.current, shelter);
    if (!owner) return;
    activateReview(owner);
    openApproval();
  }

  function reviewPicker() {
    return pendingReviews.length > 0 && <div className="pending-reviews"><label className="field-label">Perubahan yang akan disimpan<select aria-label="Perubahan yang akan disimpan" value={candidateBatchId} disabled={processing || dispatching} onChange={e => activateReview(pendingReviews.find(review => review.batchId === e.target.value) || null)}>{pendingReviews.map(review => <option key={review.batchId} value={review.batchId}>{reviewLabel(review)}{submittedReviews.current.has(review.batchId) ? ' · keputusan terkirim' : ''}</option>)}</select></label><p>{pendingReviews.length} perubahan menunggu. Persetujuan hanya untuk pilihan ini.</p></div>;
  }

  function openApproval() {
    setReviewedVersion(version);
    setConfirmed(false);
    setPartial(false);
    setDecision('');
    setClearChoices({});
    setConflictChoices({});
    setError('');
    setModal('approve');
  }

  async function approve() {
    if (dispatchInFlight.current) return;
    let dispatched = false;
    try {
      if (health && candidateBatchId && snapshotId) {
        // Live server approval
        if (version !== reviewedVersion) throw new Error('Kandidat berubah. Periksa versi terbaru.');
        if (!confirmed) throw new Error('Berikan persetujuan eksplisit atas pratinjau ini.');
        if (saveSubmitted || processing || dispatchInFlight.current) throw new Error('Keputusan penyimpanan sudah dikirim.');
        if (needsPartial && !partial) throw new Error('Konfirmasi batas data parsial terlebih dahulu.');
        if (pendingFields.some(p => !clearChoices[p.reportId]?.[p.field])) throw new Error('Putuskan setiap usulan pengosongan field.');
        if (storageConflicts(preview).some((c: any) => !conflictChoices[c.reportId]?.[c.field])) throw new Error('Putuskan setiap konflik dengan rekap tersimpan.');

        const previousCompletionRevision = completionRevision.current;
        submittedReviews.current.add(candidateBatchId);
        setSaveOutcomes(v => ({ ...v, [candidateBatchId]: 'Menyimpan' }));
        dispatchInFlight.current = true; setDispatching(true); setProcessing(true); setActivity('report');
        lastEvent.current = { type: 'sent', at: Date.now() };
        dispatched = true;
        await submitBatchDecision(candidateBatchId, {
          action: 'approve_save',
          snapshot_id: snapshotId,
          partial_acknowledged: partial,
          clear_decisions: clearChoices as Record<string, Record<string, 'clear' | 'keep' | 'defer'>>,
          ...(storageConflicts(preview).length ? { conflict_decisions: conflictChoices } : {})
        });
        close();
        setSaveSubmitted(submittedReviews.current.has(candidateRef.current));
        if (completionRevision.current === previousCompletionRevision) {
          setNotice(health.mode === 'mock_mode' ? 'Persetujuan simulasi tercatat. Memulai pemeriksaan sintetis.' : 'Persetujuan tercatat di server. Memulai write dan read-back...');
        }
      } else {
        // Demo mode simulation
        setApproved(approveDemoReview({ version, reviewedVersion, confirmed, partial, clearDecision: decision }));
        close();
        setNotice('Simulasi persetujuan tercatat. Data belum disimpan ke backend.');
      }
    } catch (e) {
      const rejected = e instanceof HttpResponseError && [400, 401, 403, 404, 422].includes(e.status);
      const unknown = dispatched && !rejected;
      if (!unknown) submittedReviews.current.delete(candidateBatchId);
      if (dispatched) { setSaveSubmitted(unknown); setSaveOutcomes(v => ({ ...v, [candidateBatchId]: unknown ? 'Hasil simpan belum terverifikasi' : 'Menunggu persetujuan' })); }
      if (dispatchInFlight.current) setProcessing(false);
      setError(unknown ? 'Hasil simpan belum diketahui. Periksa rekap tersimpan sebelum mengirim ulang.' : (e as Error).message);
    } finally {
      dispatchInFlight.current = false; setDispatching(false);
    }
  }

  async function clarify(s: Shelter, text: string, expected: ClarificationChanges, structured = false) {
    if (!health || !sessionId) { setClarificationFeedback({ kind: 'error', text: 'Hubungkan backend untuk memvalidasi perubahan.' }); return; }
    if (processing || dispatchInFlight.current) { setClarificationFeedback({ kind: 'error', text: 'Tunggu proses yang sedang berjalan sebelum mengirim perubahan.' }); return; }
    const report = s.correctionTarget?.report_id ?? s.id, batch = s.correctionTarget?.batch_id ?? s.sourceBatchId;
    clarificationAttempt.current = { shelter: s, expected, received: false };
    setClarificationFeedback({ kind: 'pending', text: 'Memvalidasi perubahan. Angka lama tetap ditampilkan sampai kandidat baru diterima.' });
    const correction = structured && batch && s.calculationKey ? { target: { report_id: report, batch_id: batch, name: s.name, village: s.village }, base_key: s.calculationKey, changes: expected } : undefined;
    const result = await send(`Mohon klarifikasi laporan ${report} (${s.name})${batch ? ` batch ${batch}` : ''}: ${text}`, correction);
    if (!result.ok) failClarification(result.message || 'Klarifikasi gagal dikirim.');
    else if (clarificationAttempt.current) clarificationAttempt.current.batchId = result.batchId;
  }

  async function copyBulletin() {
    if (!hasBulletinContent(activeBulletin) || processing || dispatching) return;
    try {
      await navigator.clipboard.writeText(bulletinForReading(activeBulletin));
      setNotice('Draf disalin ke papan klip. Periksa sebelum dibagikan.');
    } catch {
      setOperationError('Clipboard tidak tersedia. Pilih teks draf dan salin secara manual.');
    }
  }

  function download(filteredRows: Shelter[] = rows) {
    const needs = view === 'Kebutuhan';
    const content = recapCsv(filteredRows, needs ? metricKey : undefined, storageLabel);
    const url = URL.createObjectURL(new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = needs ? 'SIGAP_kebutuhan.csv' : 'SIGAP_rekap_posko.csv';
    a.click();
    URL.revokeObjectURL(url);
    setNotice('CSV diunduh sesuai filter aktif.');
  }

  function newReport() {
    setInput('');
    setFilename(undefined);
    focusComposer.current = true;
    setPage('Laporan');
    if (page === 'Laporan') { focusComposer.current = false; composer.current?.focus(); }
  }


  return <div className="app-shell">
    <header className="app-header">
      <div className="header-brand-group">
        <a className="brand" href="#laporan" onClick={e => { e.preventDefault(); setPage('Laporan') }} aria-label="SIGAP, halaman laporan">
          <BrandLogo />
          <span className="brand-name">SIGAP</span>
        </a>
        <div className="brand-vertical-divider" aria-hidden="true" />
        <div className="brand-subtitles">
          <span className="sub-title-main">Pusat Kendali</span>
          <span className="sub-title-secondary">Operasi Posko</span>
        </div>
      </div>
      <nav aria-label="Navigasi utama" className="header-nav-tabs">
        {pages.map(name => (
          <button
            key={name}
            aria-current={page === name ? 'page' : undefined}
            className={`nav-tab-btn ${page === name ? 'active' : ''}`}
            onClick={() => setPage(name)}
          >
            {name}
            {page === name && <span className="nav-tab-active-indicator" />}
          </button>
        ))}
      </nav>
      <div className="header-right-status-group">
        <div className="figma-pill-white">Operator</div>
        <button
          className="figma-pill-navy"
          type="button"
          onClick={() => setModal('connection')}
          title="Pengaturan sesi"
        >
          <span className="officer-avatar" aria-hidden="true">
            <Users size={12} />
          </span>
          <span>{operator}</span>
          <span className="arrow-up-right" aria-hidden="true">↗</span>
        </button>
        {onLogout && <button className="button quiet" onClick={onLogout}>Keluar</button>}
      </div>
    </header>
    {overviewStatus === 'loading' && (
      <div className="fetching-overlay" role="status" aria-live="polite">
        <div className="fetching-modal">
          <div className="fetching-spinner" aria-hidden="true" />
          <div className="fetching-content">
            <p className="fetching-title">{sessionId ? 'Memuat kebutuhan…' : 'Memuat rekap…'}</p>
            <p className="fetching-subtitle">Sinkronisasi data operasi posko terbaru</p>
          </div>
        </div>
      </div>
    )}
    <main id="main-content" className={`page page-${page.toLowerCase()}`}><div className="workspace-load-status">{overviewStatus === 'error' && <div className="load-status-alert" role="status"><div className="load-status-message"><AlertCircle size={16} aria-hidden="true"/><span>Ringkasan belum dimuat lengkap.</span></div><button type="button" className="load-status-retry" disabled={processing || dispatching} onClick={() => sessionId ? setOverviewReload(n => n + 1) : setBootstrapReload(n => n + 1)}><RotateCw size={13} aria-hidden="true"/>Muat ulang data</button></div>}</div><Suspense fallback={<p role="status">Memuat halaman…</p>}>
      {page !== 'Laporan' && operationError && <div className="operation-error" role="alert"><p>{operationError}</p><button className="button secondary" onClick={() => setPage('Laporan')}>Buka percakapan</button><button className="button quiet" onClick={() => setOperationError('')}>Tutup pesan gagal</button></div>}
      {page === 'Klarifikasi' && (detail && detailBinding.current === detailKey ? <ClarificationPage key={detailKey} shelter={detail} storageLabel={storageLabel(detail)} busy={processing || dispatching} canCalculate={!!health && !!sessionId}
        onCalculate={() => void send('Hitung kebutuhan seluruh posko dari rekap saat ini.')} onFocusField={focusClarification} onBack={backFromClarification} headingRef={heading}
        onApprove={reviewForShelter(pendingReviews, detail) ? () => openShelterApproval(detail) : undefined}
        onNext={(() => { const queue = tasksFor(activeRows, pendingReviews); const i = queue.findIndex(t => stableShelterKey(t.shelter) === stableShelterKey(detail)); const next = queue[i + 1]; return next ? () => openDetail(next.shelter, next.shelter.reviewItems?.[0]?.field) : undefined; })()}>
        <ClarificationForm key={stableShelterKey(detail)} layout="page" draftKey={JSON.stringify([preferenceKey, contextId, stableShelterKey(detail)])} focusField={clarificationField} focusRevision={focusRevision} shelter={detail} busy={processing || dispatching} connected={!!health && !!sessionId} feedback={clarificationFeedback} onSubmit={clarify} />
      </ClarificationPage> : <section className="card" aria-label="Klarifikasi posko"><h1 ref={heading} tabIndex={-1}>{activeRows.length ? 'Posko tidak ditemukan' : 'Memuat data posko…'}</h1><p>Halaman ini hanya membuka posko dari operasi yang sedang aktif.</p><button className="button secondary" onClick={backFromClarification}>Kembali</button></section>)}
      {page === 'Tugas' && <TasksView rows={activeRows} reviews={pendingReviews} busy={processing || dispatching} headingRef={heading} onOpen={openTask} onReport={() => setPage('Laporan')} />}
      {(page === 'Laporan' || visited.includes('Laporan')) && <div hidden={page !== 'Laporan'}><LaporanView
        originalDocument={originalDocument}
        preferenceKey={`${preferenceKey}:${contextId}`}
        onDropFiles={files => { if (files.length !== 1) { setOperationError('Pilih satu berkas setiap kali mengunggah.'); return; } void readFile(files[0]); }}
        documentBusy={documentBusy}
        documentReview={documentReview}
        onCancelDocument={cancelDocument}
        onUseDocument={useDocument}
        onDocumentTextChange={text => setDocumentReview(current => current ? { ...current, text } : null)}
        headingRef={page === 'Laporan' ? heading : inactiveHeading}
        operationError={operationError}
        onDismissError={() => setOperationError('')}
        onGoRekap={focus => { setView(focus?.metric ? 'Kebutuhan' : 'Posko'); if (focus?.metric) setMetricKey(focus.metric); setRekapFocus(previous => ({ ...focus, requestId: (previous?.requestId ?? 0) + 1 })); setPage('Rekap'); }}
        messages={messages}
        input={input}
        onInput={setInput}
        onSend={() => void send()}
        onUpload={() => upload.current?.click()}
        onClear={() => { setInput(''); setFilename(undefined); }}
        onSuggest={text => { setInput(text); composer.current?.focus(); }}
        processing={processing}
        dispatching={dispatching}
        composerRef={composer}
        chatStatus={chatStatus}
        activeRows={activeRows}
        savedRows={storedBase.current}
        onCalculate={() => void send('Hitung kebutuhan seluruh posko dari rekap saat ini.')}
        canCalculate={!!health && !!sessionId}
        onStorageLabel={storageLabel}
        preview={preview}
        version={version}
        storedLoaded={storedLoaded}
        pendingReviews={pendingReviews}
        storageVerified={storageVerified}
        saveSubmitted={saveSubmitted}
        approved={approved}
        onOpenShelterApproval={openShelterApproval}
        canApproveShelter={s => { const owner = reviewForShelter(pendingReviews, s); return !!owner?.preview.snapshot_id && !submittedReviews.current.has(owner.batchId); }}
        onSelectShelter={s => openDetail(s)}
        onClarifyClick={() => {
          const target = activeRows[0] || shelters[0];
          openDetail(target);
        }}
        filename={filename}
        onRemoveFile={() => setFilename(undefined)}
        showReportProgress={showReportProgress}
        currentStep={currentStep}
        steps={steps}
        stepCaption={stepCaption}
        batchId={batchId}
        onLoadDemo={loadDemo}
      /></div>}
      {(page === 'Rekap' || visited.includes('Rekap')) && <div hidden={page !== 'Rekap'}><RekapView
        focusRequest={rekapFocus}
        shelters={shelters}
        activeRows={activeRows}
        onSelectShelter={s => openDetail(s)}
        onDownloadCsv={download}
        onNewReport={newReport}
        onStorageLabel={storageLabel}
        onCalculate={() => void send('Periksa kebutuhan air bersih di semua posko dari rekap saat ini.')}
        onOpenApproval={openApproval}
        version={version}
        storedLoaded={storedLoaded}
        preview={preview}
        pendingReviews={pendingReviews}
        storageVerified={storageVerified}
        saveSubmitted={saveSubmitted}
        approved={approved}
        processing={processing}
        dispatching={dispatching}
        reportInFlight={reportInFlight}
        sessionId={sessionId}
        snapshotId={snapshotId}
        health={health}
        reviewPicker={reviewPicker()}
        headingRef={page === 'Rekap' ? heading : inactiveHeading}
        view={view}
        onViewChange={setView}
        metricKey={metricKey}
        onMetricKeyChange={setMetricKey}
      /></div>}

      {page === 'Buletin' && <BuletinView contextId={contextId} content={activeBulletin} batchId={bulletinBatchId} source={bulletinSource.source} sourceChanged={!!bulletinSource.source && bulletinSource.source.fingerprint !== sourceFingerprint(activeRows)} role={role} processing={processing} dispatching={dispatching} stage={stageLabel(stage)} canRequest={!!health && !!sessionId} onCopy={copyBulletin} onRequest={requestBulletin} onGoLaporan={() => setPage('Laporan')} headingRef={heading} />}
    </Suspense><footer className="page-footer">Data untuk demonstrasi Pos Komando. Keputusan distribusi tetap di tangan pimpinan.</footer>
    </main>
    <input ref={upload} type="file" accept=".txt,.csv,.pdf,.png,.jpg,.jpeg,text/plain,text/csv,application/pdf,image/png,image/jpeg" hidden onChange={e => { const file = e.target.files?.[0]; if (file) void readFile(file); }} />
    {notice && <div className="toast" role="status"><Info size={18} /><span>{notice}</span><button className="icon-button" aria-label="Tutup pemberitahuan" onClick={() => setNotice('')}><X size={18} /></button></div>}
    <dialog ref={dialog} aria-labelledby="dialog-title" className="dialog" onCancel={close} onClick={e => { if (e.target === dialog.current) close(); }}>
      <div className="dialog-heading"><span id="dialog-title">{modal === 'approve' ? 'Tinjau persetujuan' : 'Koneksi & Pengaturan Sesi'}</span><button className="icon-button" aria-label="Tutup dialog" onClick={close}><X size={20} /></button></div>
      {modal === 'approve' && <div className="dialog-body" aria-busy={dispatching}>
        <h2>{!preview || needsPartial ? 'Setujui rekap parsial?' : 'Setujui rekap?'}</h2>
        {preview && <p className="approval-scope"><strong>Kandidat yang disetujui:</strong> {reviewLabel({ batchId: candidateBatchId, preview })}. Kandidat lain menunggu persetujuan terpisah.</p>}
        <p>Pratinjau versi {reviewedVersion}{!preview || needsPartial ? ' memuat data parsial atau keputusan yang perlu ditinjau.' : ' siap ditinjau. Periksa data dan sumber sebelum menyimpan.'} Penulisan ke penyimpanan eksternal hanya dilakukan setelah konfirmasi eksplisit.</p>
        <ChangeSummary before={storedBase.current} after={preview ? previewRows(preview) : []} />
        <fieldset className="approval-inputs" disabled={dispatching}><legend className="sr-only">Keputusan dan persetujuan penyimpanan</legend>
          {preview ? pendingFields.map(p => <label className="field-label" key={p.reportId + ':' + p.field}>{p.reportId} · {p.field}<select aria-label={`Keputusan ${p.reportId} ${p.field}`} value={clearChoices[p.reportId]?.[p.field] || ''} onChange={e => setClearChoices(c => ({ ...c, [p.reportId]: { ...c[p.reportId], [p.field]: e.target.value as ClearDecision } }))}><option value="">Pilih keputusan</option><option value="clear">Kosongkan nilai</option><option value="keep">Pertahankan nilai</option><option value="defer">Tunda keputusan</option></select></label>) : <label className="field-label">Data disabilitas lama Posko Harapan<select aria-label="Keputusan pengosongan disabilitas" value={decision} onChange={e => setDecision(e.target.value as ClearDecision)}><option value="">Pilih keputusan</option><option value="clear">Kosongkan data lama</option><option value="keep">Pertahankan data lama</option><option value="defer">Tunda keputusan</option></select></label>}
          <ConflictReview preview={preview} choices={conflictChoices} onChange={setConflictChoices} />
          {(!preview || needsPartial) && <label className="checkbox-row"><input type="checkbox" checked={partial} onChange={e => setPartial(e.target.checked)} /><span>Saya memahami rekap masih parsial dan konflik belum selesai.</span></label>}
          <label className="checkbox-row"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /><span>Saya menyetujui keputusan penyimpanan atas pratinjau versi {reviewedVersion}.</span></label>
        </fieldset>
        {error && <p className="form-error" role="alert">{error}</p>}
        {saveSubmitted && !processing && saveOutcomes[candidateBatchId] === 'Hasil simpan belum terverifikasi' && <button className="button secondary" onClick={() => { close(); setPage('Laporan'); void send('Tolong baca rekap posko yang sudah tersimpan dan ringkas isinya.'); }}>Periksa rekap tersimpan</button>}
        {dispatching && <p role="status">Mengirim persetujuan. Menutup panel tidak membatalkan proses yang sedang berjalan.</p>}
        <div className="dialog-actions"><button className="button secondary" onClick={close}>Kembali periksa</button><button className="button primary" disabled={dispatching || processing || saveSubmitted} onClick={approve}>{dispatching ? 'Mengirim persetujuan…' : <>Konfirmasi persetujuan<Check size={16} /></>}</button></div>
      </div>}
      {modal === 'connection' && <div className="dialog-body"><h2>Konfigurasi LLM</h2><p>Status Backend: <strong>{health ? health.backend : 'Tidak terhubung (Mode Demo)'}</strong></p><p>LLM / Agent: <strong>{health?.model || (health?.agent === 'gemini' ? 'Gemini' : health?.agent === 'openai' ? 'DeepSeek' : health?.agent === 'mock' ? 'Simulasi lokal' : health?.agent ? 'Agent' : 'Belum terhubung')}</strong>. Status koneksi menunjukkan konfigurasi; hasil nyata diperiksa lewat workflow.</p><p>Mode Operasi: <strong>{health ? health.mode : 'Demo lokal'}</strong></p><div className="dialog-actions"><button className="button secondary" onClick={close}>Tutup</button></div></div>}
    </dialog>
  </div>;
}
