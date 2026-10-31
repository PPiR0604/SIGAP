import {useId,useMemo,useState} from 'react';
import {MarkdownContent} from './MarkdownContent';
import {storedRows} from './backendPreview';
import {metrics} from './needs';
import {metricSummary} from './chartData';
import {populationCoverage,qualityLabel} from './presentation';
import {bulletinTable} from './bulletin';
import type {Shelter} from './demo';
import './public-bulletin.css';

export type PublicBulletinData={schema_version:string;content:string;context_name:string;generated_at:string|null;approved_at?:string;source:{version:string|null;kind:string};calculation_available:boolean;records:Array<Record<string,any>&{quality:Shelter['status'];requirements?:Shelter['requirements'];shortages?:Shelter['shortages'];planning?:Shelter['planning']}>};
const date=(v:string|null|undefined)=>v&&Number.isFinite(Date.parse(v))?new Date(v).toLocaleString('id-ID',{dateStyle:'medium',timeStyle:'short'}):'Belum tersedia';
const number=(v:number)=>v.toLocaleString('id-ID',{maximumFractionDigits:1});

function NeedBar({label,total,short,unit,paired,count}:{label:string;total:number;short:number|null;unit:string;paired:number;count:number}){
 const [hover,setHover]=useState(false),[pinned,setPinned]=useState(false);const id=useId();
 return <div className="public-need-interaction" onPointerEnter={e=>{if(e.pointerType==='mouse')setHover(true);}} onPointerLeave={()=>setHover(false)} onKeyDown={e=>{if(e.key==='Escape'){setHover(false);setPinned(false);}}}>
  <button type="button" className="public-need-track" aria-label={`Detail ${label}`} aria-describedby={id} aria-expanded={hover||pinned} onFocus={()=>setHover(true)} onBlur={()=>{setHover(false);setPinned(false);}} onClick={()=>setPinned(v=>!v)}>
   <span className="public-need-total"/><span className="public-need-gap" style={{width:`${short===null||total===0?0:short/total*100}%`}}/>
  </button>
  <div id={id} role="tooltip" className="public-need-tooltip" hidden={!hover&&!pinned}><strong>{label}</strong><span>Kebutuhan: {number(total)} {unit}</span><span>Kekurangan: {short===null?'Belum diketahui':`${number(short)} ${unit}`}</span><span>Stok diketahui: {paired} dari {count} posko</span></div>
 </div>;
}

/** Admin and anonymous readers see the same source-bound public information. */
export function PublicBulletinContent({data,preview=false}:{data:PublicBulletinData;preview?:boolean}){
 const rows=useMemo(()=>storedRows(data.records).map((s,index)=>({...s,status:data.records[index].quality,requirements:data.records[index].requirements,shortages:data.records[index].shortages})),[data]);
 return <article className="card public-document public-single-panel" aria-label={preview?'Pratinjau isi publikasi':'Isi publikasi buletin'}>
  <section className="public-coverage" aria-label="Cakupan publikasi"><div><span>Posko</span><strong>{number(rows.length)} posko</strong></div><div><span>Populasi</span><strong>{populationCoverage(rows)}</strong></div><div><span>Versi sumber</span><strong>{data.source.version||'Belum tersedia'}</strong></div></section>
  <div className="public-publication-times"><span>Disusun: {date(data.generated_at)}</span><span>{preview?'Pratinjau sebelum publikasi':`Diterbitkan: ${date(data.approved_at)}`}</span><span>Sumber: {data.source.kind==='stored'?'rekap tersimpan':data.source.kind==='candidate'?'kandidat belum disimpan':'referensi belum tersedia'}</span></div>
  {(rows.some(s=>s.estimate)||rows.some(s=>qualityLabel(s)!=='Siap diperiksa'))&&<p className="public-limits" role="note">Publikasi memuat {rows.some(s=>s.estimate)?`${rows.filter(s=>s.estimate).length} posko dengan estimasi`:'data yang belum lengkap'}{rows.some(s=>s.estimate)&&rows.some(s=>qualityLabel(s)!=='Siap diperiksa')?' serta catatan pemeriksaan':''}. Angka kosong tetap berarti belum diketahui.</p>}
  <section aria-label="Diagram kebutuhan publikasi" className="public-needs-chart"><h2>Kebutuhan dan kekurangan</h2><p>Kebutuhan adalah acuan hasil hitung. Kekurangan dihitung dari stok yang diketahui.</p>
   <div className="public-chart-legend" aria-label="Legenda diagram"><span><i className="legend-total" aria-hidden="true"/>Acuan kebutuhan</span><span><i className="legend-gap" aria-hidden="true"/>Kekurangan diketahui</span></div>
   <p className="public-chart-explanation">Oranye menunjukkan bagian kebutuhan yang diketahui masih kurang. Biru menunjukkan sisa acuan; belum tentu tersedia sebagai stok.</p>
   <div className="public-needs-grid">{metrics.map(metric=>{const summary=metricSummary(rows,metric.key),total=summary.required,short=summary.shortage;return <div className="public-need-row" key={metric.key}>
    <h3>{metric.label}</h3><div className="public-need-values"><span>Kebutuhan: <strong>{total===null?'Belum dihitung':`${number(total)} ${metric.unit}`}</strong></span><span>Kekurangan: <strong>{short===null?'Belum diketahui':`${number(short)} ${metric.unit}`}</strong></span></div>
    {total!==null&&<NeedBar label={metric.label} total={total} short={short} unit={metric.unit} paired={summary.paired} count={rows.length}/>}
    {summary.calculated<rows.length&&<small>{rows.length-summary.calculated} posko belum dihitung. </small>}{summary.paired<rows.length&&<small>Kekurangan diketahui untuk {summary.paired} dari {rows.length} posko{summary.paired?' · total hanya mencakup posko tersebut':''}.</small>}
   </div>;})}</div>
  </section>
  <section className="public-bulletin-text"><div className="public-section-heading"><span className="result-eyebrow">BULETIN</span><h2>Informasi kebutuhan</h2></div><MarkdownContent text={bulletinTable(data.content,data.records)} allowImages={false}/></section>
 </article>;
}
