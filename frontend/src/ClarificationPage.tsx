import {useEffect,useRef,useState,type ReactNode,type RefObject} from 'react';
import {ArrowLeft,ArrowRight} from 'lucide-react';
import type {Shelter} from './demo';
import {qualityLabel} from './presentation';
import {PopulationDetails} from './PopulationDetails';
import {SphereNeedsDetails} from './SphereNeedsDetails';
import {ShelterNotice} from './ShelterNotice';
import {ReviewChecklist} from './ReviewChecklist';
import {HelpTip} from './HelpTip';

export function ClarificationPage({shelter,storageLabel,busy,canCalculate,onCalculate,onFocusField,onBack,onNext,onApprove,headingRef,children}:{
 shelter:Shelter;storageLabel:string;busy:boolean;canCalculate:boolean;
 onCalculate:()=>void;onFocusField:(field:string)=>void;onBack:()=>void;onNext?:()=>void;onApprove?:()=>void;
 headingRef:RefObject<HTMLHeadingElement|null>;children:ReactNode;
}){
 const [tab,setTab]=useState('Pemeriksaan');
 const root=useRef<HTMLElement>(null);
 const reference=useRef<HTMLElement>(null);
 const [sticky,setSticky]=useState(false);
 useEffect(()=>{
  const header=document.querySelector('.app-header');if(!header)return;
  const measure=()=>{const height=header.getBoundingClientRect().height;root.current?.style.setProperty('--clarification-header',`${height}px`);setSticky((reference.current?.getBoundingClientRect().height??0)<=innerHeight-height-110);};
  measure();const observer=new ResizeObserver(measure);observer.observe(header);if(reference.current)observer.observe(reference.current);
  window.addEventListener('resize',measure);return()=>{observer.disconnect();window.removeEventListener('resize',measure);};
 },[]);
 useEffect(()=>{headingRef.current?.focus({preventScroll:true});},[headingRef]);
 return <section ref={root} className="clarification-page" aria-label="Halaman klarifikasi posko">
  <header className="clarification-page-heading">
   <div><button type="button" className="button quiet clarification-back" onClick={onBack}><ArrowLeft size={17} aria-hidden="true"/>Kembali</button><div className="field-label-row"><h1 ref={headingRef} tabIndex={-1}>{shelter.name}</h1><HelpTip source label="Sumber laporan"><blockquote>{shelter.source}</blockquote><small>{shelter.time}</small></HelpTip></div><p className="detail-meta">{shelter.village} · {shelter.time}</p></div>
   <div className="clarification-page-state"><span className="badge neutral">{qualityLabel(shelter)}</span><span className="storage-state">{storageLabel}</span>{onNext&&<button type="button" className="button secondary" disabled={busy} onClick={onNext}>Posko berikutnya<ArrowRight size={16} aria-hidden="true"/></button>}</div>
  </header>
  <div className="clarification-page-grid">
   <aside ref={reference} className={`card clarification-reference${sticky?' is-sticky':''}`} aria-label="Data pembanding posko">
    <div className="clarification-section-tabs" role="group" aria-label="Bagian data pembanding">{['Pemeriksaan','Data posko','Perhitungan'].map(name=><button type="button" key={name} aria-pressed={tab===name} onClick={()=>setTab(name)}>{name}</button>)}</div>
    <div hidden={tab!=='Pemeriksaan'}><ShelterNotice shelter={shelter}/><ReviewChecklist items={shelter.reviewItems} onResolve={onFocusField}/>{!shelter.reviewItems?.length&&<p className="note">Tidak ada catatan pemeriksaan pada data ini.</p>}{onApprove&&<div className="clarification-save"><p>Perubahan belum disimpan.</p><button type="button" className="button primary" disabled={busy} onClick={onApprove}>Tinjau &amp; simpan perubahan</button></div>}</div>
    <div hidden={tab!=='Data posko'}><PopulationDetails shelter={shelter}/><h3>Kebutuhan yang dilaporkan</h3><p>{shelter.needs.join(', ')||'Belum dilaporkan'}</p></div>
    <section hidden={tab!=='Perhitungan'} aria-label="Hasil perhitungan kebutuhan"><SphereNeedsDetails shelter={shelter} onCalculate={onCalculate} canCalculate={canCalculate} busy={busy} onClarify={()=>onFocusField('children')}/></section>
   </aside>
   <div className="card clarification-editor">{children}</div>
  </div>
 </section>;
}
