import type {Shelter} from './demo';
import {metrics} from './needs';
import {metricSummary,vulnerableGroups} from './chartData';

const number=(n:number)=>n.toLocaleString('id-ID',{maximumFractionDigits:1});
export function ShelterAnalysis({shelter}:{shelter?:Shelter}){
  const groups=vulnerableGroups(shelter);
  return <div className="analysis-subwidgets-grid restored-analysis">
    <section className="analysis-widget-card" aria-label="Analisis Standar Sphere 24 Jam">
      <h3 className="widget-card-title">Analisis Standar Sphere 24 Jam</h3>
      <p className="chart-caption">{shelter?.name||'Belum ada posko dipilih'}</p>
      {metrics.map(metric=>{
        const result=metricSummary(shelter?[shelter]:[],metric.key);
        return <div className="metric-row" key={metric.key}>
          <div className="metric-label-row"><strong>{metric.label}</strong><span>{result.required===null?'Belum dihitung':`${number(result.required)} ${metric.unit}`}</span></div>
          <div className="need-meter-track" role="img" aria-label={`${metric.label}: ${result.fulfillment===null?'pemenuhan belum diketahui':`${number(result.fulfillment)}% terpenuhi`}`}>
            {result.fulfillment!==null&&<div className="need-meter-fill" style={{width:`${result.fulfillment}%`,backgroundColor:result.fulfillment===100?'#059669':'#2563eb'}}/>}
          </div>
          <p className="chart-caption">{result.shortage===null?'Stok/kekurangan belum diketahui':`Kekurangan: ${number(result.shortage)} ${metric.unit}`}</p>
        </div>;
      })}
    </section>
    <section className="analysis-widget-card" aria-label="Proporsi Kelompok Rentan">
      <h3 className="widget-card-title">Proporsi Kelompok Rentan</h3>
      <p className="vulnerable-subheading">{shelter?.people==null?'Jumlah jiwa belum diketahui':`${number(shelter.people)} jiwa terdata`}</p>
      {groups.map(group=><div className="metric-row" key={group.label}>
        <div className="metric-label-row"><strong><span className="chart-legend-dot" style={{backgroundColor:group.color}} aria-hidden="true"/>{group.label}</strong><span>{group.value===null?'Belum diketahui':`${number(group.value)} jiwa`}</span></div>
        <div className="need-meter-track" role="img" aria-label={`${group.label}: ${group.percent===null?'proporsi belum diketahui':`${number(group.percent)}% dari jumlah jiwa`}`}>
          {group.percent!==null&&<div className="need-meter-fill" style={{width:`${group.percent}%`,backgroundColor:group.color}}/>}
        </div>
        <p className="chart-caption">{group.inconsistent?'Periksa data: jumlah kelompok melebihi total jiwa.':group.percent===null?'Proporsi belum dapat ditentukan':`${number(group.percent)}% dari jumlah jiwa`}</p>
      </div>)}
      <p className="chart-caption">Kelompok dapat saling tumpang tindih; proporsi tidak dijumlahkan sebagai populasi unik.</p>
    </section>
  </div>;
}
