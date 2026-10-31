import { Info } from 'lucide-react';
import type { Shelter } from './demo';

export function ShelterNotice({ shelter }: { shelter: Shelter }) {
  const changes = shelter.changes?.filter(change => change !== 'baru') || [];
  if (!changes.length) return <div className="detail-note"><Info size={18} aria-hidden="true"/><p>{shelter.note}</p></div>;
  const mismatch = shelter.people !== null && shelter.male !== null && shelter.female !== null && shelter.male + shelter.female !== shelter.people;
  return <section className="detail-note shelter-notice" aria-label="Perubahan dan peringatan posko">
    <Info size={18} aria-hidden="true"/>
    <div className="shelter-notice-content">
      <strong>Perubahan belum disimpan</strong>
      <ul className="shelter-change-list">{changes.map((change, index) => {
        const parts = /^(.+?) (.+?) → (.+)$/.exec(change);
        return <li key={`${change}:${index}`}>{parts ? <><span>{parts[1]}</span><span>{parts[2]} → <strong>{parts[3]}</strong></span></> : <span>{change}</span>}</li>;
      })}</ul>
      {mismatch && <p className="shelter-mismatch">Periksa jumlah jiwa: {shelter.male} laki-laki + {shelter.female} perempuan = {shelter.male! + shelter.female!}, sedangkan total {shelter.people}.</p>}
      <details className="shelter-notice-details"><summary>Rincian peringatan</summary><p>{shelter.note}</p></details>
    </div>
  </section>;
}
