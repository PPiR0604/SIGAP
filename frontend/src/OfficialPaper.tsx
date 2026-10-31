import { ShieldCheck, FileText } from 'lucide-react';
import { MarkdownContent } from './MarkdownContent';
import { bulletinForReading,bulletinTable,hasBulletinContent } from './bulletin';

interface OfficialPaperProps {
  bulletinText: string;
  sourceRecords?:Record<string,any>[];
  contextName?:string;
  published?:boolean;
  snapshotId?: string;
  processing: boolean;
  dispatching: boolean;
  stageLabelText: string;
  onGoLaporan: () => void;
}

export function OfficialPaper({
  bulletinText,
  sourceRecords,
  contextName,
  published=false,
  snapshotId,
  processing,
  dispatching,
  stageLabelText,
  onGoLaporan,
}: OfficialPaperProps) {
  const isBulletinEmpty = !hasBulletinContent(bulletinText);

  return (
    <div className="official-document-container" aria-label="Dokumen Buletin Logistik">
      {(processing||dispatching)&&<p className="paper-process-status" role="status">{stageLabelText||'Agent sedang memproses'}…</p>}
      {isBulletinEmpty && (
        <div className="empty">
          <div className="empty-icon"><FileText size={22} aria-hidden="true" /></div>
          <div>
            <strong>Draf buletin belum ada</strong>
            <p>
              {processing
                ? `${stageLabelText || 'Agent sedang menyusun draf'}…`
                : 'Pilih Susun draf pada panel tindakan. Setelah selesai, periksa isi sebelum digunakan.'}
            </p>
          </div>
          <button type="button" className="button quiet" onClick={onGoLaporan}>
            Lihat jawaban Agent
          </button>
        </div>
      )}

      {/* Docs Document Paper (Clean Docs Style) */}
      {!isBulletinEmpty&&<article className="paper docs-paper-sheet" aria-label="Isi draf buletin">
        {/* Header Dokumen (Clean Docs: BPBD badge, Title, Subtitle, Release Time) */}
        <header className="docs-doc-header">
          <div className="docs-header-top">
            <span className="docs-org-badge">SIGAP</span>
            <div className="docs-title-wrap">
              <h2 className="docs-doc-title">Buletin logistik & kebutuhan pengungsi</h2>
              <p className="docs-doc-subtitle">{contextName||'Pratinjau dokumen operasi'}</p>
            </div>
          </div>
          <div className="docs-header-meta">
            <span className="docs-meta-time">{published?'Publikasi disetujui admin':'Draf kerja · publikasi melalui persetujuan admin'}</span>
          </div>
        </header>

        <div className="docs-divider" aria-hidden="true" />

        {/* Content body rendered from safe markdown */}
        <div className="docs-doc-body">
          <MarkdownContent
            text={bulletinTable(bulletinForReading(bulletinText),sourceRecords)}
            className="bulletin-markdown docs-markdown"
            tableLabel="Tabel buletin"
          />
        </div>

        {/* Docs Footer Block: Metadata Integritas Dokumen (Tanpa Tanda Tangan) */}
        <details className="docs-doc-footer" aria-label="Rincian versi dokumen"><summary>Referensi versi rekap</summary>
          <div className="docs-hash-card">
            <div className="docs-hash-row">
              <span className="docs-hash-label">Referensi sumber:</span>
              <code className="docs-hash-value">
                {snapshotId || 'Referensi belum tersedia'}
              </code>
              <span className="docs-hash-tag">{snapshotId?'Referensi tersedia':'Belum tersedia'}</span>
            </div>
            <p className="docs-hash-caption">
              Referensi rekap yang digunakan saat draf dibuat. Periksa sumber dan isi draf sebelum digunakan.
            </p>
          </div>
        </details>
      </article>}

      <p className="note">
        <ShieldCheck size={15} aria-hidden="true" />
        Keputusan distribusi tetap pada petugas berwenang.
      </p>
    </div>
  );
}
