import {useEffect,useState,type CSSProperties} from 'react';
import {Clock3,ChevronDown,ChevronUp} from 'lucide-react';
import type {Shelter} from './demo';

/** Zone-less report times are treated as WIB, the operation's reporting timezone. */
export function reportTime(value:string|null|undefined):number|null{
 if(!value)return null;
 const text=value.trim();
 const match=/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/i.exec(text);
 if(!match)return null;
 const [,year,month,day,hour,minute,second='00',zone]=match;
 const utc=Date.UTC(+year,+month-1,+day,+hour,+minute,+second),check=new Date(utc);
 if(check.getUTCFullYear()!==+year||check.getUTCMonth()!==+month-1||check.getUTCDate()!==+day||+hour>23||+minute>59||+second>59)return null;
 const parsed=Date.parse(`${year}-${month}-${day}T${hour}:${minute}:${second}${zone||'+07:00'}`);
 return Number.isFinite(parsed)?parsed:null;
}
export function StaleReports({shelters,onSelect,expanded:controlledExpanded,onToggleExpanded}:{shelters:Shelter[];onSelect:(s:Shelter)=>void;expanded?:boolean;onToggleExpanded?:()=>void}){
 const [now,setNow]=useState(Date.now);
 const [internalExpanded,setInternalExpanded]=useState(false);
 const isControlled=controlledExpanded!==undefined;
 const expanded=isControlled?controlledExpanded:internalExpanded;
 const toggle=onToggleExpanded||(()=>setInternalExpanded(v=>!v));
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),60000);return()=>clearInterval(timer);},[]);
 const entries=shelters.map(s=>({s,time:reportTime(s.lastReportedAt)}));
 const stale=entries.filter(e=>e.time!==null&&e.time<now-24*60*60*1000).sort((a,b)=>a.time!-b.time!);
 const unknown=entries.filter(e=>e.time===null||e.time>now);
 const format=(v:number)=>new Intl.DateTimeFormat('id-ID',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Jakarta'}).format(v)+' WIB';
 const hasMore=stale.length>2;
 const primaryStale=hasMore?stale.slice(0,2):stale;
 const extraStale=hasMore?stale.slice(2):[];
 return <section className="card stale-reports" aria-label="Pembaruan laporan posko">
  <div className="stale-heading-row">
   <h2><Clock3 size={17} aria-hidden="true"/>Pembaruan laporan</h2>
   {hasMore&&<button type="button" className={`button quiet stale-header-toggle ${expanded?'is-visible':'is-hidden'}`} aria-label={expanded?'Ciutkan pembaruan laporan':'Tampilkan semua pembaruan laporan'} title={expanded?'Ciutkan pembaruan laporan':'Tampilkan semua pembaruan laporan'} onClick={toggle}><ChevronUp size={16} aria-hidden="true"/></button>}
  </div>
  <p>Waktu laporan terakhir yang tercatat.</p>
  {!shelters.length?<p>Belum ada rekap tersimpan.</p>:<><strong className="stale-count">{stale.length} posko lebih dari 24 jam</strong>
   {stale.length>0&&<div className="stale-list-wrapper">
    <ul className="stale-list">
     {primaryStale.map(({s,time},i)=><li key={`${s.sourceBatchId||''}:${s.id}:${i}`}><button type="button" onClick={()=>onSelect(s)}>{s.name}</button><small>{s.village} · {format(time!)}</small></li>)}
    </ul>
    {hasMore&&<div className={`stale-extra-container ${expanded?'is-expanded':'is-collapsed'}`} aria-hidden={!expanded}>
     <div className="stale-extra-inner">
      <ul className="stale-list stale-extra-list">
       {extraStale.map(({s,time},i)=><li key={`${s.sourceBatchId||''}:${s.id}:${i+2}`} style={{'--stale-idx':i} as CSSProperties}><button type="button" onClick={()=>onSelect(s)}>{s.name}</button><small>{s.village} · {format(time!)}</small></li>)}
      </ul>
     </div>
    </div>}
   </div>}
   {hasMore&&<div className="stale-toggle-row"><button type="button" className={`stale-expand-btn ${expanded?'is-expanded':''}`} onClick={toggle} aria-expanded={expanded}><span>{expanded?'Ciutkan daftar':`Tampilkan ${stale.length-2} posko lainnya`}</span><ChevronDown className={`stale-chevron-icon ${expanded?'rotated':''}`} size={14} aria-hidden="true"/></button></div>}
   {unknown.length>0&&<details><summary>{unknown.length} waktu belum dapat dipastikan</summary><ul>{unknown.map(({s},i)=><li key={`${s.sourceBatchId||''}:${s.id}:${i}`}><button type="button" onClick={()=>onSelect(s)}>{s.name}</button><small>{s.village} · Waktu kosong, tidak valid, atau di masa depan</small></li>)}</ul></details>}
   <p className="stale-note">Laporan lama perlu dikonfirmasi; ini bukan penanda tingkat darurat.</p>
  </>}
 </section>;
}
