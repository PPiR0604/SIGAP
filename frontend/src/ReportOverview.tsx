import {ChartNoAxesCombined,ChevronDown,ArrowRight,Home,Users} from 'lucide-react';
import {StatusPie} from './StatusPie';
import {NeedsHistogram} from './NeedsHistogram';
import type {Shelter} from './demo';
import type {RekapFocus} from './chartData';

export function ReportOverview({shelters,hasPending,stored,onGoRekap,needsExpanded,statusExpanded,onToggleNeeds,onToggleStatus,onCalculate,busy=false,canCalculate=false}:{shelters:Shelter[];hasPending:boolean;stored:boolean;onGoRekap:(focus?:RekapFocus)=>void;needsExpanded:boolean;statusExpanded:boolean;onToggleNeeds:()=>void;onToggleStatus:()=>void;onCalculate?:()=>void;busy?:boolean;canCalculate?:boolean}){
 const total=shelters.length,known=shelters.filter(s=>s.people!==null),unknown=total-known.length,people=known.reduce((sum,s)=>sum+s.people!,0);
 const count=(value:number)=>value.toLocaleString('id-ID');
 return <div className="report-panel-group" role="region" aria-label="Ringkasan seluruh posko">
  <section className="report-summary-card" aria-label="Jumlah seluruh posko">
   <div className="report-overview-title"><ChartNoAxesCombined size={18} aria-hidden="true"/><div><h2>Ringkasan seluruh posko</h2><small>{total?`${count(total)} posko · ${known.length?count(people):'Belum diketahui'} jiwa terdata`:'Belum ada data posko'}</small></div></div>
   {total>0&&<div className="report-stats-highlight" aria-label="Sorotan posko dan jiwa">
    <div className="report-stat-tile">
     <div className="report-stat-tile-header"><Home size={14} aria-hidden="true"/><span>Posko</span></div>
     <strong className="report-stat-tile-number">{count(total)}</strong>
    </div>
    <div className="report-stat-tile">
     <div className="report-stat-tile-header"><Users size={14} aria-hidden="true"/><span>Jiwa</span></div>
     <strong className="report-stat-tile-number">{known.length?count(people):'—'}</strong>
    </div>
   </div>}
   <p>{hasPending?'Ada perubahan belum disimpan':stored?'Rekap tersimpan':'Rekap sesi ini'}</p>
   {unknown>0&&<p>Jumlah jiwa {unknown} posko belum diketahui.</p>}
   <button type="button" className="button quiet" onClick={()=>onGoRekap()}>Lihat rekap<ArrowRight size={16} aria-hidden="true"/></button>
  </section>
  <section className="report-independent-card" aria-label="Panel total kebutuhan">
   <div className="report-independent-heading">
    <h2>Total kebutuhan</h2>
    <button type="button" className="button quiet preview-toggle" aria-label={`${needsExpanded?'Ciutkan':'Buka'} total kebutuhan`} aria-controls="report-needs-panel" aria-expanded={needsExpanded} onClick={onToggleNeeds}>{needsExpanded?'Ciutkan':'Buka'}<ChevronDown size={16} className={needsExpanded?'preview-chevron expanded':'preview-chevron'} aria-hidden="true"/></button>
   </div>
   <div id="report-needs-panel" className={`disclosure-motion${needsExpanded?'':' is-closed'}`} aria-hidden={!needsExpanded} inert={!needsExpanded}><div className="disclosure-inner"><div className="report-independent-content">{total?<NeedsHistogram shelters={shelters} onView={metric=>onGoRekap({metric})} onCalculate={onCalculate} busy={busy} canCalculate={canCalculate}/>:<p>Belum ada data kebutuhan.</p>}</div></div></div>
  </section>
  <section className="report-independent-card" aria-label="Panel status pemeriksaan"><div className="report-independent-heading"><h2>Status pemeriksaan</h2><button type="button" className="button quiet preview-toggle" aria-label={`${statusExpanded?'Ciutkan':'Buka'} status pemeriksaan`} aria-controls="report-status-panel" aria-expanded={statusExpanded} onClick={onToggleStatus}>{statusExpanded?'Ciutkan':'Buka'}<ChevronDown size={16} className={statusExpanded?'preview-chevron expanded':'preview-chevron'} aria-hidden="true"/></button></div><div id="report-status-panel" className={`disclosure-motion${statusExpanded?'':' is-closed'}`} aria-hidden={!statusExpanded} inert={!statusExpanded}><div className="disclosure-inner"><div className="report-independent-content"><StatusPie compact shelters={shelters} selected="" onSelect={status=>onGoRekap({status:status as RekapFocus['status']})}/></div></div></div></section>
 </div>;
}
