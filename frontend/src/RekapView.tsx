import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  ChevronRight,
  Plus,
  Search,
  ShieldCheck,
  TriangleAlert,
  Users
} from 'lucide-react';
import { type Shelter, type RequirementKey } from './demo';
import { metricValue, metrics } from './needs';
import { reviewSummary } from './reviewIndicators';
import { reviewLabel, reviewForShelter } from './pendingReviews';
import { populationCoverage, qualityLabel } from './presentation';
import { NeedsCategoryTable } from './NeedsCategoryTable';
import { needCategories, shelterReportsCategory, type NeedCategoryKey, type RekapFocus } from './chartData';
import { StatusPie } from './StatusPie';

const number = (value: number | null) =>
  value === null ? 'Belum diketahui' : new Intl.NumberFormat('id-ID').format(value);

export interface RekapViewProps {
  focusRequest?: (RekapFocus & { requestId: number }) | null;
  shelters: Shelter[];
  activeRows: Shelter[];
  onSelectShelter: (s: Shelter) => void;
  onDownloadCsv: (rows: Shelter[]) => void;
  onNewReport: () => void;
  onOpenApproval: () => void;
  onStorageLabel: (s: Shelter) => string;
  onCalculate: () => void;
  version: number;
  storedLoaded: boolean;
  preview: any;
  pendingReviews: any[];
  storageVerified: boolean;
  saveSubmitted: boolean;
  approved: any;
  processing: boolean;
  dispatching: boolean;
  reportInFlight: boolean;
  sessionId: string;
  snapshotId: string;
  health: any;
  reviewPicker?: React.ReactNode;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  view?: 'Posko' | 'Kebutuhan';
  onViewChange?: (view: 'Posko' | 'Kebutuhan') => void;
  metricKey?: RequirementKey;
  onMetricKeyChange?: (key: RequirementKey) => void;
}

export function RekapView(p: RekapViewProps) {
  useEffect(() => { const target = p.headingRef.current; if (target && !target.closest('[hidden]')) target.focus(); }, [p.headingRef]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('Semua status');
  const [village, setVillage] = useState('');
  const [page, setPage] = useState(1);
  const [category, setCategory] = useState<NeedCategoryKey | null>(null);
  const [resultRequest, setResultRequest] = useState(0);
  const resultsAnchor = useRef<HTMLDivElement>(null);
  const activeCategory = needCategories.find(c => c.key === category);
  useEffect(() => {
    if (!p.focusRequest) return;
    setQuery(''); setVillage(''); setPage(1);
    setStatus(p.focusRequest.status || 'Semua status');
    setCategory(p.focusRequest.category || null);
    if (p.focusRequest.status || p.focusRequest.category || p.focusRequest.metric) setResultRequest(n => n + 1);
  }, [p.focusRequest]);
  useEffect(() => {
    if (!resultRequest) return;
    const target = resultsAnchor.current;
    if (target) { target.style.scrollMarginTop = `${(document.querySelector('.app-header')?.getBoundingClientRect().height ?? 64) + 20}px`; target.focus({ preventScroll: true }); target.scrollIntoView({ block: 'start' }); }
  }, [resultRequest]);
  const pageSize = 10;
  const view = p.view || 'Posko';
  const metric = metrics.find(m => m.key === p.metricKey) || metrics[0];
  const rows = p.activeRows.filter(s => (!category || shelterReportsCategory(s, category)) && (`${s.name} ${s.village} ${s.id} ${s.needs.join(' ')}`).toLowerCase().includes(query.trim().toLowerCase()) && (!village || s.village === village) && (status === 'Semua status' || (status === 'Ada perubahan belum disimpan' ? !!reviewForShelter(p.pendingReviews, s) : status === 'Perlu pemeriksaan' ? qualityLabel(s) !== 'Siap diperiksa' : status === 'Siap ditinjau' ? qualityLabel(s) === 'Siap diperiksa' : s.status === status)));
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, pages);
  const paged = rows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const needsReview = p.activeRows.filter(s => s.status !== 'Siap ditinjau').length;
  const people = p.activeRows.reduce((sum, s) => sum + (s.people ?? 0), 0);
  const unknown = p.activeRows.filter(s => s.people === null).length;
  const reset = () => { setQuery(''); setStatus('Semua status'); setVillage(''); setCategory(null); setPage(1); };
  const selectCategory = (key: NeedCategoryKey) => { reset(); setCategory(key); p.onViewChange?.('Posko'); setResultRequest(n => n + 1); };
  const quantity = (s: Shelter, gap = false) => { const value = metricValue(s, metric.key, gap); return value === null ? 'Belum diketahui' : `${number(value)} ${metric.unit}`; };
  return <div className="rekap-exact-view">
    <div className="figma-rekap-sub-header"><div className="rekap-sub-header-top">PUSAT KENDALI OPERASI · BASIS DATA LOGISTIK TERPILAH</div><div className="rekap-sub-header-main"><h1 ref={p.headingRef} tabIndex={-1}>Rekap posko</h1><button className="button primary" onClick={p.onNewReport}><Plus size={16} />Laporan baru</button></div></div>
    <div className="figma-stats-grid functional-stats">{[['Posko terdata', p.activeRows.length], ['Jiwa terdata', number(people)], ['Perlu pemeriksaan', needsReview], ['Jumlah jiwa belum diketahui', unknown]].map(([label, value]) => label === 'Perlu pemeriksaan' ? <button type="button" className="card recap-review-stat" key={String(label)} aria-label={`${needsReview} posko perlu diperiksa. Periksa`} onClick={() => { reset(); setStatus('Perlu pemeriksaan'); setResultRequest(n => n + 1); }}><span>{label}</span><strong>{value}</strong><span className="text-link">Lihat posko <ChevronRight size={15} aria-hidden="true" /></span></button> : <div className="card" key={String(label)}><span>{label}</span><strong>{value}</strong></div>)}</div>
    <p className="coverage-note">{populationCoverage(p.activeRows)}</p>
    <div className="restored-recap-charts"><NeedsCategoryTable onCalculate={p.onCalculate} busy={p.processing || p.dispatching} shelters={p.activeRows} selectedCategory={category} onSelectCategory={selectCategory} /><StatusPie shelters={p.activeRows} selected={status} onSelect={next => { reset(); setStatus(next); p.onViewChange?.('Posko'); setResultRequest(n => n + 1); }} onSelectShelter={p.onSelectShelter} /></div>
    <section className="card functional-recap" aria-label="Daftar posko"><div className="heading-row"><div><h2>Daftar posko</h2><p>{p.activeRows.length} posko · {p.storageVerified ? 'Tersimpan' : p.storedLoaded && !p.preview ? 'Rekap tersimpan' : 'Termasuk kandidat belum disimpan'}</p></div></div>
      <div className="view-switch" role="group" aria-label="Jenis rekap">{(['Posko', 'Kebutuhan'] as const).map(v => <button key={v} className={view === v ? 'selected' : ''} onClick={() => p.onViewChange?.(v)}>{v}</button>)}</div>
      <div className="toolbar functional-filters"><label className="search"><Search size={17} /><input aria-label="Cari posko atau desa" placeholder="Cari posko atau desa" value={query} onChange={e => { setQuery(e.target.value); setPage(1); }} /></label><select aria-label="Filter status" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}>{['Semua status', 'Ada perubahan belum disimpan', 'Perlu pemeriksaan', 'Perlu klarifikasi', 'Parsial', 'Siap ditinjau', 'Menunggu persetujuan'].map(v => <option key={v} value={v}>{v === 'Parsial' ? 'Data belum lengkap' : v === 'Siap ditinjau' ? 'Siap diperiksa' : v}</option>)}</select><select aria-label="Filter desa" value={village} onChange={e => { setVillage(e.target.value); setPage(1); }}><option value="">Semua desa</option>{[...new Set(p.activeRows.map(s => s.village))].sort().map(v => <option key={v} value={v}>{v === 'Parsial' ? 'Data belum lengkap' : v === 'Siap ditinjau' ? 'Siap diperiksa' : v}</option>)}</select>{view === 'Kebutuhan' && <select aria-label="Jenis kebutuhan" value={metric.key} onChange={e => p.onMetricKeyChange?.(e.target.value as RequirementKey)}>{metrics.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}</select>}<button className="button secondary" onClick={() => p.onDownloadCsv(rows)}><ArrowDownToLine size={16} />Unduh CSV</button></div>
      <div ref={resultsAnchor} role="group" tabIndex={-1} className={`recap-filter-summary${activeCategory ? ' has-category' : ''}`} aria-label="Hasil filter rekap"><p role="status">{activeCategory ? <><strong>{activeCategory.label}</strong> · {rows.length} posko ditampilkan</> : `${rows.length} dari ${p.activeRows.length} posko ditampilkan`}</p>{activeCategory && <button type="button" className="button quiet" onClick={() => { setCategory(null); setPage(1); setResultRequest(n => n + 1); }}>Hapus filter kebutuhan</button>}</div>
      <div className="table-scroll" role="region" aria-label="Tabel rekap posko" tabIndex={0}><table><thead><tr><th>Posko</th><th>Kebutuhan dilaporkan</th>{view === 'Posko' ? <><th>Jumlah jiwa</th><th>Status laporan</th></> : <><th>{metric.key === 'jamban_unit' ? 'Kebutuhan jamban' : `Kebutuhan ${metric.label}`}</th><th>Kekurangan</th></>}<th><span className="sr-only">Aksi</span></th></tr></thead><tbody>{paged.map(s => <tr key={JSON.stringify([s.sourceBatchId, s.id, s.name, s.village])}><td><button className="shelter-link" onClick={() => p.onSelectShelter(s)}>{s.name}</button><small className="shelter-village">{s.village} · {s.changes?.length ? 'diperbarui · belum disimpan' : s.time}</small>{reviewSummary(s.reviewItems) && <button className="review-summary text-link" aria-label={`Lihat pemeriksaan ${s.name}`} onClick={() => p.onSelectShelter(s)}>{reviewSummary(s.reviewItems)}</button>}</td><td>{s.needs.join(', ') || 'Belum dilaporkan'}</td>{view === 'Posko' ? <><td className="population">{number(s.people)}</td><td><span className={`badge ${s.status === 'Siap ditinjau' ? 'success' : s.status === 'Perlu klarifikasi' ? 'warning' : 'neutral'}`}>{qualityLabel(s)}</span><small className="storage-state">{p.onStorageLabel(s)}</small></td></> : <><td>{quantity(s)}</td><td>{quantity(s, true)}</td></>}<td><button className="icon-button" aria-label={`Detail ${s.name}`} onClick={() => p.onSelectShelter(s)}><ChevronRight size={18} /></button></td></tr>)}</tbody></table></div>
      <div className="recap-mobile-list" aria-label="Posko pada layar kecil">{paged.map(s => <article className="card" key={JSON.stringify([s.sourceBatchId, s.id])}><h3><button className="shelter-link" onClick={() => p.onSelectShelter(s)}>{s.name}</button></h3><p>{s.village}</p><p><strong>{number(s.people)} jiwa</strong> · {qualityLabel(s)}</p><p>{p.onStorageLabel(s)}</p><p>{s.needs.join(', ') || 'Belum dilaporkan'}</p>{view === 'Kebutuhan' && <p>{metric.label}: {quantity(s)} · Kekurangan: {quantity(s, true)}</p>}<button className="button secondary" onClick={() => p.onSelectShelter(s)}>Periksa posko</button></article>)}</div>
      {!rows.length && <div className="empty"><div><h3>{p.activeRows.length ? 'Tidak ada posko yang cocok dengan filter' : 'Belum ada kandidat rekap'}</h3><p>{p.activeRows.length ? 'Ubah pencarian atau filter untuk melihat posko lain.' : 'Kirim laporan atau baca rekap tersimpan melalui percakapan.'}</p><button className="button secondary" onClick={reset}>Reset filter</button></div></div>}
      <div className="table-footer functional-pagination"><span>Menampilkan {paged.length} dari {rows.length} posko</span><div><button className="button quiet" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Sebelumnya</button><span>Halaman {currentPage} dari {pages}</span><button className="button quiet" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>Berikutnya</button></div></div>
      {view === 'Kebutuhan' && <p className="note">Acuan kebutuhan: {metric.basis}. Kekurangan hanya diketahui jika data stok dan waktunya lengkap.</p>}
      <p className="note">Status tersimpan menunjukkan data sudah dicatat. Kelengkapan dan konflik ditampilkan pada status masing-masing posko.</p>
      {p.reviewPicker}<div className="review-actions"><div><span className="version">{p.storedLoaded && !p.preview ? 'Rekap tersimpan' : `Pratinjau perubahan versi ${p.version}`}</span><p>{p.saveSubmitted ? (p.health?.mode === 'mock_mode' ? 'Keputusan simulasi tercatat. Tidak ada penulisan nyata.' : 'Keputusan tercatat. Menunggu verifikasi penyimpanan.') : p.preview ? 'Periksa data dan keputusan sebelum menyetujui.' : 'Belum ada perubahan baru untuk disetujui.'}</p></div><button className="button primary" disabled={p.processing || p.dispatching || p.saveSubmitted || !p.preview || !p.snapshotId} onClick={p.onOpenApproval}><ShieldCheck size={17} />{p.saveSubmitted ? 'Keputusan tercatat' : 'Tinjau & setujui'}</button></div>
    </section>
  </div>;
}
