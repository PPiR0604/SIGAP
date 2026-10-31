import {ArrowRight} from 'lucide-react';
import {HelpTip} from './HelpTip';
import type {Shelter,RequirementKey} from './demo';
import {metrics} from './needs';
import {metricSummary} from './chartData';
const colors:Record<RequirementKey,string>={air_liter_per_hari:'#2563eb',kkal_per_hari:'#d97706',jamban_unit:'#0891b2',ruang_hunian_m2:'#059669'};
const number=(n:number)=>n.toLocaleString('id-ID',{maximumFractionDigits:1});

export function NeedsHistogram({shelters,onView,onCalculate,busy=false,canCalculate=false}:{shelters:Shelter[];onView:(metric:RequirementKey)=>void;onCalculate?:()=>void;busy?:boolean;canCalculate?:boolean}){
 const totals=metrics.map(metric=>({...metric,...metricSummary(shelters,metric.key)}));
 const incomplete=totals.some(metric=>metric.calculated<shelters.length);
 const sameCoverage=totals.every(metric=>metric.calculated===totals[0].calculated);
 return <div className="overview-histogram" role="group" aria-label="Kebutuhan seluruh posko">
  <div className="overview-total-bars">{totals.map(metric=>{
   const value=metric.required,power=10**Math.floor(Math.log10(value||1)),fraction=(value||0)/power;
   const ceiling=value?(fraction<=1?1:fraction<=2?2:fraction<=5?5:10)*power:1;
   return <div className="overview-total-item" key={metric.key}>
    <button type="button" className="overview-total-heading" onClick={()=>onView(metric.key)} aria-label={`Rincian ${metric.label.toLocaleLowerCase('id-ID')}`}><span>{metric.label}</span><strong>{value===null?'Belum dihitung':`${number(value)} ${metric.unit}`}</strong><ArrowRight size={14} aria-hidden="true"/></button>
    {value!==null&&<><div className="overview-total-track" role="img" aria-label={`${metric.label}: ${number(value)} ${metric.unit}; skala 0–${number(ceiling)} ${metric.unit}`}><span style={{width:`${value/ceiling*100}%`,background:colors[metric.key]}}/></div><div className="overview-total-axis" aria-hidden="true"><span>0</span><span>{number(ceiling)} {metric.unit}</span></div></>}
    {!sameCoverage&&metric.calculated<shelters.length&&<small className="histogram-missing">{shelters.length-metric.calculated} posko belum dihitung</small>}
   </div>;
  })}</div>
  {sameCoverage&&incomplete&&<small className="histogram-missing">{shelters.length-totals[0].calculated} posko belum dihitung</small>}
  <div className="histogram-actions"><div className="histogram-legend-hint"><small>Skala per satuan</small><HelpTip label="Arti diagram kebutuhan"><p>Total seluruh posko dari hasil hitung server, bukan kekurangan setelah stok. Semua jenis ditampilkan sekaligus.</p><p>Setiap batang memiliki skala dan satuan sendiri. Panjang batang antarjenis tidak dibandingkan karena liter, kkal, unit, dan m² berbeda.</p><p>Hasil yang belum dihitung tidak dianggap nol. Pilih angka kebutuhan untuk membuka rincian.</p></HelpTip></div>{incomplete&&onCalculate&&<button type="button" className="button quiet" disabled={busy||!canCalculate} onClick={onCalculate}>{busy?'Menghitung…':'Hitung kebutuhan'}</button>}</div>
 </div>;
}
