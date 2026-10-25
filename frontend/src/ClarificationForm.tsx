import { useEffect, useRef, useState } from 'react';
import { MessageSquare } from 'lucide-react';
import type { Shelter } from './demo';

const fields = [
  ['people', 'Jumlah jiwa'], ['male', 'Laki-laki'], ['female', 'Perempuan'],
  ['elderly', 'Lansia'], ['disability', 'Disabilitas'],
] as const;
type Draft = Record<typeof fields[number][0], string>;
const values = (shelter: Shelter): Draft => Object.fromEntries(fields.map(([key]) => [key, shelter[key] === null ? '' : String(shelter[key])])) as Draft;
export type ClarificationFeedback = { kind: 'pending' | 'success' | 'error'; text: string } | null;
export type ClarificationChanges = Partial<Record<typeof fields[number][0], number>>;

export function ClarificationForm({ shelter, busy, connected, feedback, onSubmit }: {
  shelter: Shelter;
  busy: boolean;
  connected: boolean;
  feedback: ClarificationFeedback;
  onSubmit: (shelter: Shelter, text: string, changes: ClarificationChanges) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => values(shelter));
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const firstInput = useRef<HTMLInputElement>(null);
  const errorBox = useRef<HTMLParagraphElement>(null);
  // Calculation results replace the object too. Only a changed edit source may reset the form.
  const draftSource=JSON.stringify([shelter.sourceBatchId,shelter.id,shelter.name,shelter.village,fields.map(([key])=>shelter[key])]);
  useEffect(() => {
    // Preserve requested values if the returned candidate did not apply them.
    if (feedback?.kind === 'error') return;
    setDraft(values(shelter)); setNote(''); setError('');
  }, [draftSource]);
  useEffect(() => { if (editing) firstInput.current?.focus(); }, [editing]);
  useEffect(() => { if (feedback?.kind === 'success' && !busy) setEditing(false); }, [feedback, busy]);
  useEffect(() => { if (error) errorBox.current?.focus(); }, [error]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    const changes: string[] = [];
    const expected: ClarificationChanges = {};
    for (const [key, label] of fields) {
      if (draft[key].trim() === '') continue; // Clearing requires a separate, explicit field decision.
      const value = Number(draft[key]);
      if (!Number.isSafeInteger(value) || value < 0) { setError(`${label} harus berupa bilangan bulat nol atau lebih.`); return; }
      // The source validator binds numbers to adjacent labels (label: number).
      if (value !== shelter[key]) { changes.push(`${label.toLowerCase()}: ${value}`); expected[key] = value; }
    }
    if (note.trim()) changes.push(note.trim());
    if (!changes.length) { setError('Ubah setidaknya satu angka atau tulis catatan klarifikasi.'); return; }
    setError('');
    await onSubmit(shelter, changes.join('. ') + '.', expected);
  }

  return <section className="inline-clarification" aria-label="Klarifikasi posko">
    {feedback && <p role={feedback.kind === 'error' ? 'alert' : 'status'} className={feedback.kind === 'error' ? 'form-error' : 'clarification-feedback'}>{feedback.text}</p>}
    {!editing ? <button className="button secondary" disabled={busy || !connected} onClick={() => { setDraft(values(shelter)); setNote(''); setError(''); setEditing(true); }}><MessageSquare size={16} aria-hidden="true"/>Tulis klarifikasi</button> :
      <form onSubmit={submit} noValidate aria-label="Form klarifikasi" aria-busy={busy}>
        <h3>Klarifikasi langsung</h3>
        <p id="clarification-help">Ubah angka yang sudah dikonfirmasi di lapangan. Kolom kosong tidak menghapus nilai lama. Perubahan akan divalidasi menjadi kandidat baru dan belum disimpan.</p>
        {error && <p className="form-error" role="alert" tabIndex={-1} ref={errorBox}>{error}</p>}
        <fieldset disabled={busy} aria-describedby="clarification-help">
          <legend className="sr-only">Angka dan catatan klarifikasi</legend>
          <div className="clarification-grid">{fields.map(([key, label], index) => <label className="field-label" key={key}>{label}<input ref={index === 0 ? firstInput : undefined} type="number" min="0" step="1" inputMode="numeric" value={draft[key]} placeholder="Belum diketahui" onChange={event => setDraft(current => ({ ...current, [key]: event.target.value }))}/></label>)}</div>
          <label className="field-label clarification-note">Catatan klarifikasi (opsional)<textarea rows={3} value={note} onChange={event => setNote(event.target.value)} placeholder="Misalnya: kebutuhan air sudah terpenuhi, atau jelaskan data yang perlu dikosongkan."/></label>
          <div className="clarification-actions"><button type="button" className="button secondary" onClick={() => { setEditing(false); setError(''); }}>Batal</button><button type="submit" className="button primary">{busy ? 'Memvalidasi…' : 'Validasi perubahan'}</button></div>
        </fieldset>
      </form>}
    {!connected && <p className="muted">Hubungkan backend untuk memvalidasi perubahan. Data contoh tidak dapat diubah menjadi rekap nyata.</p>}
  </section>;
}
