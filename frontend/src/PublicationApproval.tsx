import {useEffect,useRef,useState} from 'react';
import {Copy,ExternalLink,Link2} from 'lucide-react';
import {authenticatedRequest,getBatchState} from './api';
import {PublicBulletinContent,type PublicBulletinData} from './PublicBulletinContent';

type ShareLink={share_id:string;path:string;approved_at:string};
type Review={content:string;batchId:string;review_id:string;review_sha256:string;data:PublicBulletinData};
const message=(e:unknown)=>{
 const text=e instanceof Error?e.message:'';
 if(/PREVIEW_CHANGED/.test(text))return 'Draf berubah. Susun atau tinjau ulang sebelum menerbitkan.';
 if(/PUBLICATION_REVIEW_EXPIRED/.test(text))return 'Tinjauan sudah berakhir. Buka Tinjau publikasi kembali.';
 if(/PUBLICATION_BUSY/.test(text))return 'Publikasi sedang diproses. Periksa status tautan sebelum mencoba lagi.';
 return 'Status publikasi belum dapat dipastikan. Periksa status tautan sebelum mengulang persetujuan.';
};

/** Public access is a separate, explicit approval of this exact server-rendered projection. */
export function PublicationApproval({content,batchId,busy:agentBusy,onPublished,revision=0,onLinkChanged}:{content:string;batchId:string;busy:boolean;onPublished?:()=>void;revision?:number;onLinkChanged?:()=>void}){
 const [review,setReview]=useState<Review|null>(null),[link,setLink]=useState<ShareLink|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[ack,setAck]=useState(false),[revoking,setRevoking]=useState(false);
 const dialog=useRef<HTMLDialogElement>(null),dialogHeading=useRef<HTMLHeadingElement>(null),linkInput=useRef<HTMLInputElement>(null),inFlight=useRef(false);
 const current=useRef({content,batchId,onPublished});current.current={content,batchId,onPublished};
 const url=link?new URL(link.path,location.origin).href:'';
 useEffect(()=>{let active=true;setReview(null);setLink(null);setError('');setNotice('');setAck(false);setRevoking(false);
  if(batchId)authenticatedRequest(`/api/batches/${batchId}/publication-link`).then(result=>{if(active&&result.link){setLink(result.link);current.current.onPublished?.();}}).catch(()=>{if(active)setError('Tautan publikasi belum dapat diperiksa.');});
  return()=>{active=false;};
 },[content,batchId,revision]);
 useEffect(()=>{if(review){dialog.current?.showModal();dialogHeading.current?.focus();}else dialog.current?.close();},[review]);
 async function open(){
  if(inFlight.current||!batchId||agentBusy)return;inFlight.current=true;setBusy(true);setError('');setAck(false);const selected={content,batchId};
  try{
   const batch=await getBatchState(selected.batchId);
   if(batch.bulletin?.content!==selected.content)throw new Error('PREVIEW_CHANGED');
   const result=await authenticatedRequest(`/api/batches/${selected.batchId}/publication-preview`);
   if(current.current.content!==selected.content||current.current.batchId!==selected.batchId)throw new Error('PREVIEW_CHANGED');
   setReview({...selected,...result});
  }catch(e){setError(message(e));}finally{inFlight.current=false;setBusy(false);}
 }
 async function confirm(){
  if(!review||!ack||inFlight.current||agentBusy)return;const selected=review;
  if(current.current.content!==selected.content||current.current.batchId!==selected.batchId){setReview(null);setError(message(new Error('PREVIEW_CHANGED')));return;}
  inFlight.current=true;setBusy(true);setError('');
  try{
   const result=await authenticatedRequest(`/api/batches/${selected.batchId}/publication/public`,{method:'POST',body:JSON.stringify({review_id:selected.review_id,review_sha256:selected.review_sha256,public_acknowledged:true})});
   if(current.current.content!==selected.content||current.current.batchId!==selected.batchId)return;
   setLink(result);setReview(null);setNotice('Publikasi disetujui. Tautan siap dibagikan.');current.current.onPublished?.();onLinkChanged?.();
  }catch(e){setError(message(e));}finally{inFlight.current=false;setBusy(false);}
 }
 async function check(){if(inFlight.current)return;const selected={content,batchId};inFlight.current=true;setBusy(true);setError('');try{const result=await authenticatedRequest(`/api/batches/${selected.batchId}/publication-link`);if(current.current.content!==selected.content||current.current.batchId!==selected.batchId)return;setLink(result.link);setNotice(result.link?'Tautan aktif dan siap dibagikan.':'Belum ada tautan aktif untuk draf ini.');if(result.link){setReview(null);current.current.onPublished?.();onLinkChanged?.();}}catch(e){if(current.current.content===selected.content&&current.current.batchId===selected.batchId)setError(message(e));}finally{inFlight.current=false;setBusy(false);}}
 async function copy(){try{await navigator.clipboard.writeText(url);setNotice('Tautan disalin.');}catch{linkInput.current?.focus();linkInput.current?.select();setNotice('Tekan Ctrl / ⌘ + C untuk menyalin tautan.');}}
 async function revoke(){if(!link||inFlight.current)return;inFlight.current=true;setBusy(true);setError('');try{await authenticatedRequest(`/api/batches/${batchId}/publication-link/${link.share_id}`,{method:'DELETE'});setLink(null);setRevoking(false);setNotice('Tautan dinonaktifkan. Buletin tidak dapat dibuka lewat tautan tersebut.');onLinkChanged?.();}catch(e){setError(message(e));}finally{inFlight.current=false;setBusy(false);}}
 return <section className="card publication-approval" aria-label="Persetujuan publikasi"><h3><Link2 size={18} aria-hidden="true"/>Bagikan publikasi</h3><p>Pembaca membuka buletin dan diagram tanpa akun.</p>
  {link?<><label htmlFor="publication-share-url">Tautan publik</label><input ref={linkInput} id="publication-share-url" className="publication-link-field" readOnly value={url} onFocus={e=>e.target.select()}/><div className="publication-link-actions"><button className="button primary" onClick={()=>void copy()}><Copy size={16} aria-hidden="true"/>Salin tautan</button><a className="button secondary" href={link.path} target="_blank" rel="noopener noreferrer"><ExternalLink size={16} aria-hidden="true"/>Buka publikasi</a><button className="button quiet" disabled={busy} onClick={()=>setRevoking(true)}>Nonaktifkan tautan</button></div></>:<button className="button primary" disabled={!batchId||agentBusy||busy} onClick={()=>void open()}>{busy?'Menyiapkan tinjauan…':'Tinjau publikasi'}</button>}
  {!batchId&&<p className="note">Susun draf dari server untuk menyiapkan publikasi.</p>}
  {notice&&<p className="publication-share-feedback" role="status">{notice}</p>}
  {error&&!review&&<div role="alert"><p>{error}</p><button className="button secondary" disabled={busy} onClick={()=>void check()}>Periksa status tautan</button></div>}
  {revoking&&<div className="publication-revoke-warning"><strong>Nonaktifkan tautan publik?</strong><p>Pembaca tidak dapat lagi membuka tautan ini.</p><div className="publication-link-actions"><button className="button secondary" disabled={busy} onClick={()=>setRevoking(false)}>Batal</button><button className="button primary" disabled={busy} onClick={()=>void revoke()}>Ya, nonaktifkan</button></div></div>}
  <dialog ref={dialog} className="dialog publication-review-dialog" aria-labelledby="publication-review-title" onCancel={e=>{if(busy)e.preventDefault();else setReview(null);}}><div className="dialog-body"><h2 ref={dialogHeading} tabIndex={-1} id="publication-review-title">Tinjau halaman publik</h2><p className="public-review-notice">Siapa pun yang memiliki tautan dapat membaca isi dan data di bawah ini tanpa login. Periksa informasi sebelum menerbitkan.</p>{review&&<PublicBulletinContent data={review.data} preview/>}
   <label className="public-consent"><input type="checkbox" checked={ack} disabled={busy} onChange={e=>setAck(e.target.checked)}/>Saya menyetujui isi buletin dan data diagram ini untuk akses publik tanpa login.</label>
   {error&&<div role="alert"><p>{error}</p><button className="button secondary" disabled={busy} onClick={()=>void check()}>Periksa status tautan</button></div>}
   <div className="dialog-actions"><button className="button secondary" disabled={busy} onClick={()=>setReview(null)}>Kembali periksa</button><button className="button primary" disabled={busy||agentBusy||!ack} onClick={()=>void confirm()}>{busy?'Menerbitkan…':'Setujui & buat tautan'}</button></div>
  </div></dialog>
 </section>;
}
