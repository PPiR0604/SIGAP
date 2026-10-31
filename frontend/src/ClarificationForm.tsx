import { useEffect, useRef, useState } from 'react';
import { MessageSquare } from 'lucide-react';
import type { Shelter,RequirementKey } from './demo';
import {StockEditor} from './StockEditor';
import {FieldSource} from './FieldSource';
import {HelpTip} from './HelpTip';

const fields = [
  ['people', 'Jumlah jiwa'], ['male', 'Laki-laki'], ['female', 'Perempuan'],
  ['elderly', 'Lansia'], ['disability', 'Disabilitas'],
  ['totalFamilies','Jumlah KK'],['toddler','Bayi/balita'],['children','Anak'],['pregnant','Ibu hamil'],['breastfeeding','Ibu menyusui'],
] as const;
type Draft = Record<typeof fields[number][0] | 'name' | 'village' | 'needs', string>;
const known = (text:string) => /belum diketahui|^\?$|^—$/.test(text.toLowerCase()) ? '' : text;
const values = (shelter: Shelter): Draft => ({...Object.fromEntries(fields.map(([key]) => [key, shelter[key] == null ? '' : String(shelter[key])])),name:known(shelter.name),village:known(shelter.village),needs:shelter.needs.join('\n')}) as Draft;
export type ClarificationFeedback = { kind: 'pending' | 'success' | 'error'; text: string } | null;
export type ClarificationChanges = Partial<Record<typeof fields[number][0], number>> & {name?:string;village?:string;needs?:string[];reportedAt?:string;estimate?:boolean;stock?:Partial<Record<RequirementKey,number>>;stockContext?:Shelter['stockContext'];clearFields?:string[];note?:string};
const normalized = (text:string) => text.trim().replace(/\s+/g,' ').toLocaleLowerCase('id-ID');
function focusClarification(target:HTMLElement|null){
 if(!target)return;
 target.focus({preventScroll:true});
 const header=document.querySelector('.app-header')?.getBoundingClientRect().height??64;
 const footer=document.querySelector('.clarification-actions')?.getBoundingClientRect().height??0;
 const bounds=target.getBoundingClientRect();
 const behavior=matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth';
 if(bounds.top<header+16)target.scrollIntoView({block:'start',behavior});
 else if(bounds.bottom>innerHeight-footer-16)target.scrollIntoView({block:'end',behavior});
}
export function clarificationApplied(shelter:Shelter, changes:ClarificationChanges){
  return Object.entries(changes).every(([key,value])=>{
    if(key==='note')return true;
    if(key==='clearFields')return (value as string[]).every(field=>shelter.pendingClearFields?.includes(field));
    if(key==='stock')return Object.entries(value as object).every(([k,v])=>shelter.stock?.[k as RequirementKey]===v);
    if(key==='stockContext')return Object.entries(value as object).every(([k,v])=>Object.entries(v).every(([field,n])=>String((shelter.stockContext?.[k as RequirementKey] as any)?.[field]??'').replace('T',' ').slice(0,16)===String(n).replace('T',' ').slice(0,16)));
    if(key==='reportedAt')return (shelter.reportedAt||'').replace('T',' ').slice(0,16)===String(value).replace('T',' ').slice(0,16);
    if(key==='needs')return JSON.stringify([...new Set(shelter.needs.map(normalized))].sort())===JSON.stringify([...new Set((value as string[]).map(normalized))].sort());
    const actual=(shelter as any)[key];
    return typeof value==='string'?typeof actual==='string'&&normalized(actual)===normalized(value):actual===value;
  });
}

export function ClarificationForm({ shelter, busy, connected, feedback, onSubmit,draftKey='local',focusField,focusRevision=0,layout='inline' }: {
  draftKey?:string;focusField?:string;focusRevision?:number;layout?:'inline'|'page';
  shelter: Shelter;
  busy: boolean;
  connected: boolean;
  feedback: ClarificationFeedback;
  onSubmit: (shelter: Shelter, text: string, changes: ClarificationChanges,structured?:boolean) => Promise<void>;
}) {
  const [editing, setEditing] = useState(layout==='page');
  const [section,setSection]=useState<'data'|'stock'|'notes'>('data');
  const storageKey=`sigap:clarification:${draftKey}`;
  const [draft, setDraft] = useState<Draft>(() => {try{return JSON.parse(sessionStorage.getItem(storageKey)||'null')?.draft||values(shelter);}catch{return values(shelter);}});
  const [extra,setExtra]=useState<ClarificationChanges>(()=>{try{return JSON.parse(sessionStorage.getItem(storageKey)||'null')?.extra||{};}catch{return {};}});
  const [baseKey,setBaseKey]=useState(()=>{try{return JSON.parse(sessionStorage.getItem(storageKey)||'null')?.baseKey||shelter.calculationKey;}catch{return shelter.calculationKey;}});
  const [note, setNote] = useState(()=>{try{return JSON.parse(sessionStorage.getItem(storageKey)||'null')?.note||'';}catch{return '';}});
  const [extraError,setExtraError]=useState('');
  const [error, setError] = useState('');
  const [errorField,setErrorField]=useState('');
  const firstInput = useRef<HTMLInputElement>(null);
  const errorBox = useRef<HTMLParagraphElement>(null);
  const reviewField: Record<string, string> = { name:'shelter_name', village:'village', people:'total_people', needs:'urgent_needs',totalFamilies:'total_families',toddler:'infants_toddlers' };
  function fieldHint(key: keyof Draft) {
    const field = reviewField[key] || key;
    const relevant = (shelter.reviewItems || []).filter(item => item.field === field || (item.field === 'male+female' && ['male','female','people'].includes(key)));
    if (!relevant.length) return null;
    const missing = relevant.some(item => item.kind === 'missing');
    const other = relevant.find(item => item.kind !== 'missing');
    return <span id={`clarification-${key}-hint`} className="clarification-field-hint">{missing ? (draft[key].trim() ? 'Diisi, belum divalidasi.' : 'Belum dilaporkan.') : 'Perlu diperiksa.'}{other ? ` ${other.text}` : ''}</span>;
  }
  const sourceHintId = (key: keyof Draft) => (shelter.reviewItems || []).some(item => item.field === (reviewField[key] || key) || (item.field === 'male+female' && ['male','female','people'].includes(key))) ? `clarification-${key}-hint` : undefined;
  const hintId=(key:keyof Draft)=>[sourceHintId(key),errorField===key?'clarification-'+key+'-error':null].filter(Boolean).join(' ')||undefined;
  // Calculation results replace the object too. Only a changed edit source may reset the form.
  const draftSource=JSON.stringify([shelter.sourceBatchId,shelter.id,shelter.name,shelter.village,shelter.needs,fields.map(([key])=>shelter[key])]);
  useEffect(() => {
    // Preserve requested values if the returned candidate did not apply them.
    if (feedback?.kind === 'error'||editing) return;
    try{if(sessionStorage.getItem(storageKey))return;}catch{}
    setDraft(values(shelter));setBaseKey(shelter.calculationKey); setNote(''); setError('');
  }, [draftSource]);
  useEffect(() => { if (editing&&layout!=='page') firstInput.current?.focus(); }, [editing,layout]);
  useEffect(() => { if (feedback?.kind === 'success' && !busy) {setEditing(false);setDraft(values(shelter));setExtra({});setBaseKey(shelter.calculationKey);setNote('');} }, [feedback, busy]);
  useEffect(() => { if (error) focusClarification(errorBox.current); }, [error]);
  useEffect(()=>{if(editing)try{sessionStorage.setItem(storageKey,JSON.stringify({draft,extra,baseKey,note}));}catch{}},[draft,extra,baseKey,note,editing,storageKey]);
  useEffect(()=>{if(feedback?.kind==='success'&&!busy)try{sessionStorage.removeItem(storageKey);}catch{}},[feedback,busy,storageKey]);
  useEffect(()=>{if(!focusField)return;setEditing(true);setSection(['urgent_needs','stock','stock_context','air_liter_per_hari','kkal_per_hari','jamban_unit','ruang_hunian_m2'].includes(focusField)?'stock':focusField==='notes'?'notes':'data');const frame=requestAnimationFrame(()=>{
    const metric=['air_liter_per_hari','kkal_per_hari','jamban_unit','ruang_hunian_m2'].includes(focusField)?focusField:null;
    const target=metric?document.querySelector<HTMLElement>(`[data-stock-field="${metric}"]`):focusField==='stock'||focusField==='stock_context'?document.querySelector<HTMLElement>('[data-stock-field]'):document.getElementById('clarification-'+(focusField==='reported_at'?'reportedAt':focusField==='male+female'?'people':Object.keys(reviewField).find(k=>reviewField[k]===focusField)||focusField));
    focusClarification(target||document.getElementById('clarification-note'));
  });return()=>cancelAnimationFrame(frame);},[focusField,focusRevision]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setErrorField('');
    if(extraError){setSection('stock');setError(extraError);return;}
    const changes: string[] = [];
    const expected: ClarificationChanges = {...extra};
    if(!expected.clearFields?.length)delete expected.clearFields;
    for(const [key,label]of [['name','nama posko'],['village','desa']] as const){
      const value=draft[key].trim();
      if(value&&normalized(value)!==normalized(shelter[key])){expected[key]=value;changes.push(`ubah ${label}${key==='village'?' posko':''} ini menjadi ${JSON.stringify(value)}`);}
    }
    const needs=[...new Set(draft.needs.split(/\n|;/).map(s=>s.trim()).filter(Boolean))];
    if(needs.length&&!clarificationApplied(shelter,{needs})){expected.needs=needs;changes.push(`ganti daftar kebutuhan yang dilaporkan hanya untuk posko ini menjadi: ${needs.join('; ')}`);}
    for (const [key, label] of fields) {
      if (draft[key].trim() === '') continue; // Clearing requires a separate, explicit field decision.
      const value = Number(draft[key]);
      if (!Number.isSafeInteger(value) || value < 0) { setSection('data');setErrorField(key);setError(`${label} harus berupa bilangan bulat nol atau lebih.`); return; }
      // The source validator binds numbers to adjacent labels (label: number).
      if (value !== shelter[key]) { changes.push(`${label.toLowerCase()}: ${value}`); expected[key] = value; }
    }
    const canonical:Record<string,string>={people:'total_people',totalFamilies:'total_families',toddler:'infants_toddlers',needs:'urgent_needs',stockContext:'stock_context'};
    if((expected.clearFields||[]).some(field=>Object.keys(expected).some(key=>key!=='clearFields'&&(canonical[key]||key)===field))){setError('Pilih mengubah nilai atau mengusulkan pengosongan untuk kolom yang sama.');return;}
    if (note.trim()) changes.push(note.trim());
    if(Object.keys(extra).length)changes.push('Perbarui data tambahan yang dikonfirmasi petugas.');
    if (!changes.length) { setError('Ubah setidaknya satu data atau tulis catatan klarifikasi.'); return; }
    setError('');setErrorField('');
    const structured=Object.keys(expected).length>0;
    if(structured&&note.trim())expected.note=note.trim();
    await onSubmit({...shelter,calculationKey:baseKey||shelter.calculationKey}, changes.join('.\n') + '.', expected,structured);
  }

  return <section className="inline-clarification" aria-label="Klarifikasi posko">
    {feedback && <p role={feedback.kind === 'error' ? 'alert' : 'status'} className={feedback.kind === 'error' ? 'form-error' : 'clarification-feedback'}>{feedback.text}</p>}
    {!editing ? <button className="button secondary" disabled={busy || !connected} onClick={() => { setError(''); setEditing(true); }}><MessageSquare size={16} aria-hidden="true"/>Tulis klarifikasi</button> :
      <form onSubmit={submit} noValidate aria-label="Form klarifikasi" aria-busy={busy}>
        <div className="field-label-row"><h3>Perbarui data posko</h3><HelpTip label="Panduan klarifikasi"><p id="clarification-help">Isi atau ubah data yang sudah dikonfirmasi. Kolom kosong tidak menghapus nilai lama. Setelah validasi, tinjau dan setujui untuk menyimpan.</p></HelpTip></div>
        {error && <p className="form-error" role="alert" tabIndex={-1} ref={errorBox}>{error}{errorField&&<button type="button" className="button quiet" onClick={()=>{setSection('data');requestAnimationFrame(()=>document.getElementById('clarification-'+errorField)?.focus());}}>Perbaiki kolom</button>}</p>}
        {layout==='page'&&<div className="clarification-section-tabs" role="group" aria-label="Bagian formulir klarifikasi">{([['data','Data posko'],['stock','Kebutuhan & stok'],['notes','Catatan']] as const).map(([key,label])=><button type="button" key={key} aria-pressed={section===key} onClick={()=>setSection(key)}>{label}</button>)}</div>}
        <fieldset disabled={busy||!connected} aria-describedby="clarification-help">
          <legend className="sr-only">Identitas, angka, kebutuhan dan catatan klarifikasi</legend>
          <div hidden={layout==='page'&&section!=='data'}><div className="clarification-section"><h4>Identitas posko</h4><div className="clarification-grid">{(['name','village'] as const).map(key=><div className="clarification-field" key={key}><div className="field-label-row"><label className="field-label" htmlFor={`clarification-${key}`}>{key==='name'?'Nama posko':'Desa'}</label><FieldSource shelter={shelter} field={reviewField[key]||key}/></div><input id={`clarification-${key}`} value={draft[key]} maxLength={200} placeholder={key==='village'?'Belum diketahui':undefined} aria-describedby={hintId(key)} onChange={e=>setDraft(d=>({...d,[key]:e.target.value}))}/>{fieldHint(key)}{errorField===key&&<small id={`clarification-${key}-error`} className="field-error">{error}</small>}</div>)}</div></div>
          <div className="clarification-section"><h4>Data pengungsi</h4><div className="clarification-grid">{fields.map(([key, label], index) => <div className="clarification-field" key={key}><div className="field-label-row"><label className="field-label" htmlFor={`clarification-${key}`}>{label}</label><FieldSource shelter={shelter} field={reviewField[key]||key}/></div><input id={`clarification-${key}`} ref={index === 0 ? firstInput : undefined} type="number" aria-invalid={errorField===key} min="0" step="1" inputMode="numeric" value={draft[key]} placeholder="Belum diketahui" aria-describedby={hintId(key)} onChange={event => setDraft(current => ({ ...current, [key]: event.target.value }))}/>{fieldHint(key)}{errorField===key&&<small id={`clarification-${key}-error`} className="field-error">{error}</small>}</div>)}</div></div>
          </div><div hidden={layout==='page'&&section!=='stock'}><div className="clarification-section"><h4>Kebutuhan</h4><div className="field-label clarification-note"><div className="field-label-row"><label htmlFor="clarification-needs">Kebutuhan yang dilaporkan</label><HelpTip label="Panduan kebutuhan yang dilaporkan"><p id="clarification-needs-help">Satu kebutuhan per baris. Daftar ini mengganti kebutuhan posko ini saja. Untuk mengosongkan daftar, gunakan Usulkan pengosongan data.</p></HelpTip></div><textarea id="clarification-needs" rows={3} maxLength={4000} value={draft.needs} onChange={e=>setDraft(d=>({...d,needs:e.target.value}))} aria-describedby={['clarification-needs-help',hintId('needs')].filter(Boolean).join(' ')}/>{fieldHint('needs')}</div></div>
          </div><StockEditor shelter={shelter} extra={extra} onChange={setExtra} onError={setExtraError} section={layout==='page'?section:undefined} focusField={focusField} focusRevision={focusRevision}/><div hidden={layout==='page'&&section!=='notes'}>
          <label className="field-label clarification-note">Catatan klarifikasi (opsional)<textarea id="clarification-note" rows={3} value={note} onChange={event => setNote(event.target.value)} placeholder="Misalnya: kebutuhan air sudah terpenuhi, atau jelaskan data yang perlu dikosongkan."/></label>
          </div><div className="clarification-actions">{layout==='page'&&<span>Validasi belum menyimpan data.</span>}<button type="button" className="button secondary" onClick={() => { setEditing(false); setError(''); }}>Batal</button><button type="submit" className="button primary">{busy ? 'Memvalidasi…' : 'Validasi perubahan'}</button></div>
        </fieldset>
      </form>}
    {!connected && <p className="muted">Hubungkan backend untuk memvalidasi perubahan. Data contoh tidak dapat diubah menjadi rekap nyata.</p>}
  </section>;
}
