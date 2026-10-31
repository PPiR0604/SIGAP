import {ChevronRight,AlertTriangle} from 'lucide-react';
import type {Shelter} from './demo';
import {metrics} from './needs';
import {metricSummary,shelterKey} from './chartData';

const number=(n:number)=>n.toLocaleString('id-ID',{maximumFractionDigits:1});
export function NeedSummaryCard({shelters}:{shelters:Shelter[]}){
  return <section className="need-summary-card" aria-label="Ringkasan Kebutuhan Darurat">
    <div className="need-summary-header"><h3 className="need-summary-title">Kebutuhan hasil hitung</h3><span className="need-summary-badge">Hasil perhitungan server</span></div>
    <p className="need-summary-subtitle">Total kebutuhan dalam liter, energi, jamban, dan luas hunian; berbeda dari jumlah posko yang melapor.</p>
    <div className="need-summary-list">{metrics.map(metric=>{
      const summary=metricSummary(shelters,metric.key);
      return <div className="need-item-row" key={metric.key}>
        <div className="need-item-top"><strong>{metric.label}</strong><span className="need-item-value">{summary.required===null?'Belum dihitung':`${number(summary.required)} ${metric.unit}`}</span></div>
        <div className="need-meter-track" role="img" aria-label={`${metric.label}: ${summary.fulfillment===null?'pemenuhan stok belum dapat ditentukan':`${number(summary.fulfillment)}% terpenuhi dari ${summary.paired} posko dengan data lengkap`}`}>
          {summary.fulfillment!==null&&<div className="need-meter-fill" style={{width:`${summary.fulfillment}%`,backgroundColor:'#2563eb'}}/>}
        </div>
        <span className="need-item-basis">{summary.calculated}/{shelters.length} posko dihitung · {summary.fulfillment===null?'Pemenuhan belum diketahui':`${number(summary.fulfillment)}% stok terpenuhi pada ${summary.paired} posko terukur`}</span>
      </div>;
    })}</div>
  </section>;
}

export function PrioritySheltersCard({shelters,onSelectShelter}:{shelters:Shelter[];onSelectShelter:(s:Shelter)=>void}){
  const rows=shelters.filter(s=>s.status!=='Siap ditinjau');
  return <section className="priority-shelters-card" aria-label="Posko Perlu Pemeriksaan"><div className="priority-card-header"><h3 className="priority-card-title"><AlertTriangle size={15}/>Posko Perlu Pemeriksaan</h3><span className="priority-count">{rows.length} posko</span></div>
    <p className="priority-subtitle">Periksa kelengkapan dan konflik data sebelum mengambil keputusan distribusi.</p>
    <div className="priority-list">{rows.slice(0,4).map(s=><button className="priority-row-btn" key={shelterKey(s)} onClick={()=>onSelectShelter(s)}><div className="priority-row-info"><strong>{s.name}</strong><span className="priority-meta">{s.village} · {s.status}</span></div><ChevronRight size={16}/></button>)}</div>
    {!rows.length&&<p>Tidak ada posko yang memerlukan pemeriksaan dalam rekap ini.</p>}
  </section>;
}
