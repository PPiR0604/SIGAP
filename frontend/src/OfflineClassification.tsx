import {ActionButton} from './ui/ActionButton';
import {useEffect,useRef,useState} from 'react';
import {ClarificationForm,type ClarificationChanges,type ClarificationFeedback} from './ClarificationForm';
import {ClarificationPage} from './ClarificationPage';
import {addReport,cachedShelters,deleteCachedShelters,type OfflineShelters} from './offlineQueue';
import type {Shelter} from './demo';
import {stableShelterKey} from './presentation';

const blank=():Shelter=>({id:crypto.randomUUID(),name:'',village:'',people:null,male:null,female:null,elderly:null,disability:null,status:'Perlu klarifikasi',needs:[],time:'Laporan baru',source:'Diisi manual oleh petugas',water:null,gap:null,note:'Laporan baru di perangkat. Isian belum divalidasi.'});
const labels:Record<string,string>={people:'jumlah jiwa',male:'laki-laki',female:'perempuan',elderly:'lansia',disability:'disabilitas',totalFamilies:'jumlah KK',toddler:'bayi/balita',children:'anak',pregnant:'ibu hamil',breastfeeding:'ibu menyusui',needs:'kebutuhan mendesak',reportedAt:'waktu laporan',estimate:'estimasi',stock:'stok',stockContext:'konteks stok',clearFields:'usulan pengosongan',note:'catatan'};
export function OfflineClassification(){
 const [copies,setCopies]=useState<OfflineShelters[]>([]),[selection,setSelection]=useState<{shelter:Shelter;copy?:OfflineShelters}|null>(null);
 const [busy,setBusy]=useState(false),[feedback,setFeedback]=useState<ClarificationFeedback>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[removeId,setRemoveId]=useState('');
 const heading=useRef<HTMLHeadingElement>(null),locked=useRef(false);
 useEffect(()=>{let active=true;const update=()=>{void cachedShelters().then(items=>{if(active)setCopies(items);}).catch(()=>{if(active)setError('Salinan data posko belum dapat dibaca.');});};const channel=typeof BroadcastChannel==='undefined'?undefined:new BroadcastChannel('sigap-offline-updates');if(channel)channel.onmessage=update;window.addEventListener('focus',update);window.addEventListener('sigap-offline-changed',update);update();return()=>{active=false;channel?.close();window.removeEventListener('focus',update);window.removeEventListener('sigap-offline-changed',update);};},[]);
 async function save(shelter:Shelter,text:string,changes:ClarificationChanges){
  if(locked.current)return;locked.current=true;setBusy(true);
  try{
   const name=changes.name||shelter.name,village=changes.village||shelter.village;
   const batch=shelter.correctionTarget?.batch_id||shelter.sourceBatchId;
   const payload=selection?.copy&&batch&&shelter.calculationKey?{target:{report_id:shelter.correctionTarget?.report_id||shelter.id,batch_id:batch,name:shelter.name,village:shelter.village},base_key:shelter.calculationKey,changes}:undefined;
   if(selection?.copy&&!payload)throw Error('Salinan ini tidak memiliki referensi koreksi yang lengkap. Buka data terbaru saat online sebelum menyiapkan koreksi.');
   const report=payload?`Mohon klarifikasi laporan ${payload.target.report_id} (${shelter.name}) batch ${batch}: ${text}`:[`Laporan posko: ${name}. Desa: ${village}.`,...Object.entries(changes).filter(([key])=>!['name','village'].includes(key)).map(([key,value])=>`${labels[key]||key}: ${typeof value==='object'?JSON.stringify(value):value}.`)].join('\n');
   await addReport(report,payload&&selection?.copy?{owner:selection.copy.owner,contextId:selection.copy.contextId,payload}:undefined);
   try{sessionStorage.removeItem('sigap:clarification:offline:'+JSON.stringify([selection?.copy?.id,selection?.copy?.savedAt,stableShelterKey(shelter)]));}catch{}
   setNotice('Draf tersimpan di antrean perangkat. Belum dikirim, divalidasi, atau disimpan ke rekap.');
   setSelection(null);setFeedback(null);setError('');
  }catch(e){setFeedback({kind:'error',text:e instanceof Error?e.message:'Draf belum tersimpan.'});}
  finally{locked.current=false;setBusy(false);}
 }
 if(selection)return <ClarificationPage shelter={{...selection.shelter,name:selection.shelter.name||'Laporan posko baru',village:selection.shelter.village||'Desa belum diisi'}} storageLabel={selection.copy?'Salinan perangkat · belum tersinkron':'Draf baru · tersimpan setelah menekan Simpan'} busy={busy} canCalculate={false} onCalculate={()=>{}} onFocusField={()=>{}} onBack={()=>{setSelection(null);setFeedback(null);}} headingRef={heading}>
  <ClarificationForm key={JSON.stringify([selection.copy?.id,stableShelterKey(selection.shelter)])} draftKey={'offline:'+JSON.stringify([selection.copy?.id,selection.copy?.savedAt,stableShelterKey(selection.shelter)])} shelter={selection.shelter} busy={busy} connected={false} offline layout="page" feedback={feedback} onSubmit={save}/>
 </ClarificationPage>;
 return <section className="offline-reports" aria-label="Klarifikasi offline"><h2>Data posko offline</h2><p>Isi jumlah jiwa, laki-laki, perempuan, kebutuhan dan stok lewat formulir. Salinan posko hanya tersedia jika sebelumnya disimpan dari rekap online. Salinan ini dapat dibaca oleh pengguna profil browser ini.</p><ActionButton type="button" className="button secondary" onClick={()=>{setFeedback(null);setSelection({shelter:blank()});}}>Buat laporan lewat formulir</ActionButton>
 {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}{!copies.length&&<p>Belum ada salinan posko. Saat online, pilih “Simpan rekap untuk offline”.</p>}
 {copies.map(copy=><article className="offline-report-item" key={copy.id}><h3>{copy.contextId}</h3><p>Disalin {new Date(copy.savedAt).toLocaleString('id-ID')} · {copy.rows.length} posko. Koreksi harus dikirim menggunakan akun dan pos komando asal.</p><div className="offline-report-actions">{copy.rows.map(shelter=><ActionButton type="button" className="button secondary" key={stableShelterKey(shelter)} onClick={()=>{setFeedback(null);setSelection({shelter,copy});}}>Klarifikasi {shelter.name} · {shelter.village}</ActionButton>)}<ActionButton type="button" className="button quiet" onClick={()=>setRemoveId(copy.id)}>Hapus salinan posko</ActionButton></div>{removeId===copy.id&&<div><p>Hapus salinan posko di perangkat? Draf laporan dalam antrean tetap tersedia.</p><ActionButton type="button" className="button secondary" onClick={()=>void deleteCachedShelters(copy.id).then(()=>{setCopies(items=>items.filter(item=>item.id!==copy.id));setRemoveId('');}).catch(()=>setError('Salinan belum dapat dihapus.'))}>Ya, hapus salinan posko</ActionButton><ActionButton type="button" className="button quiet" onClick={()=>setRemoveId('')}>Batal</ActionButton></div>}</article>)}
 </section>;
}
