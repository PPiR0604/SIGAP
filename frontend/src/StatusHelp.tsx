import {useId,useRef,useEffect, useState} from 'react';
import {Info} from 'lucide-react';

export function StatusHelp(){
 const id=useId();
 const [hovered,setHovered]=useState(false),[pinned,setPinned]=useState(false);
 const visible=hovered||pinned;
 const button=useRef<HTMLButtonElement>(null);
 const content=useRef<HTMLDivElement>(null);
 useEffect(()=>{const close=()=>{setPinned(false);setHovered(false);};window.addEventListener('sigap-page-changed',close);return()=>window.removeEventListener('sigap-page-changed',close);},[]);
 useEffect(()=>{if(!visible)return;const outside=(e:PointerEvent)=>{if(!button.current?.contains(e.target as Node)&&!content.current?.contains(e.target as Node)){setPinned(false);setHovered(false);}};document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);},[visible]);
 return <div className="status-help" onPointerEnter={e=>{if(e.pointerType==='mouse')setHovered(true);}} onPointerLeave={e=>{if(e.pointerType==='mouse')setHovered(false);}} onKeyDown={e=>{if(e.key==='Escape'){setPinned(false);setHovered(false);}}}>
  <button ref={button} type="button" className="status-help-button" aria-label="Arti status pemeriksaan" aria-expanded={visible} aria-controls={id} onClick={()=>{setHovered(false);setPinned(value=>!value);}}><Info size={17} aria-hidden="true"/></button>
  <div ref={content} id={id} className="status-help-content" hidden={!visible}><strong>Arti status</strong><dl>
   <div><dt>Perlu klarifikasi</dt><dd>Ada data yang tidak sesuai atau perlu diperiksa kembali.</dd></div>
   <div><dt>Data belum lengkap</dt><dd>Sebagian data belum dilaporkan. Nilai kosong berbeda dari angka nol.</dd></div>
   <div><dt>Siap diperiksa</dt><dd>Data siap untuk diperiksa; status ini tidak berarti sudah disetujui.</dd></div>
   <div><dt>Penyimpanan</dt><dd>Ditampilkan terpisah pada posko: belum disimpan, menunggu persetujuan, menyimpan, atau tersimpan. Data tersimpan masih dapat belum lengkap.</dd></div>
  </dl></div>
 </div>;
}
