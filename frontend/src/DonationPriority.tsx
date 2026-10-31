import { Copy, FileText, Printer, CheckCircle2, ShieldCheck, Heart, AlertCircle, Clock, MapPin, Database } from 'lucide-react';
import type { Shelter } from './demo';

interface DonationPriorityProps {
  shelters: Shelter[];
  snapshotId?: string;
  storageVerified: boolean;
  onCopy: () => void;
  onRequestBulletin: () => void;
  processing: boolean;
  dispatching: boolean;
  canRequest: boolean;
}

export function DonationPriorityCard({shelters}:{shelters:Shelter[]}) {
 const counts=new Map<string,number>();
 for(const shelter of shelters)for(const need of new Set(shelter.needs.map(s=>s.trim().toLowerCase()).filter(Boolean)))counts.set(need,(counts.get(need)||0)+1);
 const items=[...counts].sort((a,b)=>b[1]-a[1]);
 return <section className="donation-priority-card" aria-label="Kebutuhan yang dilaporkan"><h3 className="donation-card-title"><Heart size={15}/>Kebutuhan yang dilaporkan</h3><p className="donation-subtitle">Jumlah posko yang melaporkan kebutuhan pada sumber draf.</p>{items.length?<div className="donation-list">{items.map(([need,count])=><div className="donation-item-row" key={need}><strong>{need}</strong><span>{count} posko</span></div>)}</div>:<p>Belum ada kebutuhan yang dilaporkan.</p>}</section>;
}

export function SnapshotMetadataCard({
  shelters,
  snapshotId,
  storageVerified,
  contextName,
}: {
  shelters: Shelter[];
  snapshotId?: string;
  storageVerified: boolean;
  contextName?:string;
}) {
  const totalPeople = shelters.reduce((acc, s) => acc + (s.people || 0), 0);
  const number = (v: number) => new Intl.NumberFormat('id-ID').format(v);

  return (
    <details className="snapshot-card" aria-label="Rincian sumber buletin"><summary>Rincian sumber dan versi</summary>
      <div className="snapshot-header">
        <h3 className="snapshot-title">
          <Database size={15} className="snapshot-icon" aria-hidden="true" />
          Sumber rekap
        </h3>
        <span className={storageVerified ? 'snapshot-badge-verified' : 'snapshot-badge-draft'}>
          {!snapshotId?'Referensi belum tersedia':storageVerified ? 'Tersimpan' : 'Kandidat pemeriksaan'}
        </span>
      </div>

      <dl className="snapshot-meta-grid">
        <div className="snapshot-meta-item">
          <dt><Clock size={12} aria-hidden="true" /> Referensi versi rekap</dt>
          <dd>
            {snapshotId || 'Belum tersedia'}
          </dd>
        </div>

        <div className="snapshot-meta-item">
          <dt><MapPin size={12} aria-hidden="true" /> Operasi</dt>
          <dd>{contextName||'Nama operasi belum tersedia'}</dd>
        </div>

        <div className="snapshot-meta-item">
          <dt><CheckCircle2 size={12} aria-hidden="true" /> Populasi</dt>
          <dd>{shelters.length?`${number(totalPeople)} jiwa terdata (${shelters.length} posko)`:'Belum ada data'}{shelters.some(s=>s.people===null)&&' · total belum lengkap'}</dd>
        </div>

        <div className="snapshot-meta-item">
          <dt><ShieldCheck size={12} aria-hidden="true" /> Standar Acuan</dt>
          <dd>Sphere Handbook 2018</dd>
        </div>
      </dl>
    </details>
  );
}

export function BulletinActionsCard({
  hasDraft,
  onCopy,
  onRequestBulletin,
  processing,
  dispatching,
  canRequest,
  sourceChanged=false,
  composeInHeader=false,
}: {
  composeInHeader?:boolean;
  sourceChanged?:boolean;
  hasDraft: boolean;
  onCopy: () => void;
  onRequestBulletin: () => void;
  processing: boolean;
  dispatching: boolean;
  canRequest: boolean;
}) {
  return (
    <div className="bulletin-actions-card" aria-label="Aksi Buletin">
      <h3 className="bulletin-actions-title">{sourceChanged?'Perbarui draf':hasDraft?'Gunakan draf':'Susun buletin'}</h3>
      <p>{processing||dispatching?'Sedang memproses. Draf sebelumnya tetap tersedia untuk dibaca.':sourceChanged?'Susun ulang agar draf memakai data terbaru.':hasDraft?'Salin atau cetak sebagai draf. Publikasi memerlukan persetujuan admin.':'Ringkas rekap menjadi draf untuk diperiksa.'}</p>
      <div className="bulletin-actions-stack">
        {hasDraft&&<button type="button" className={`button ${sourceChanged?'secondary':'primary'} bulletin-action-btn`} disabled={processing||dispatching} onClick={onCopy}>
          <Copy size={16} aria-hidden="true" />
          Salin draf
        </button>}

        {(hasDraft||!composeInHeader)&&(
          <button
            type="button"
            className={`button ${!hasDraft||sourceChanged?'primary':'secondary'} bulletin-action-btn`}
            disabled={!canRequest || processing || dispatching}
            onClick={onRequestBulletin}
          >
            <FileText size={16} aria-hidden="true" />
            {hasDraft?'Susun ulang draf':'Susun draf'}
          </button>
        )}

        <button
          type="button"
          className="button quiet bulletin-action-btn"
          disabled={!hasDraft||processing||dispatching}
          onClick={() => {if(hasDraft&&!processing&&!dispatching)window.print();}}
        >
          <Printer size={16} aria-hidden="true" />
          Cetak draf
        </button>
      </div>
      {!canRequest&&<p className="note">Hubungkan backend dari halaman Laporan untuk menyusun draf.</p>}
    </div>
  );
}
