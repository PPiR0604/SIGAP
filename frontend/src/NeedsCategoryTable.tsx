import {ArrowRight} from 'lucide-react';
import type {Shelter} from './demo';
import {categoryCounts,metricSummary,shelterReportsCategory,type NeedCategoryKey} from './chartData';
import {metrics} from './needs';
import type {RequirementKey} from './demo';

const categoryMetrics:Partial<Record<NeedCategoryKey,{key:RequirementKey;label:string}>>={
  air:{key:'air_liter_per_hari',label:'Air bersih'},
  pangan:{key:'kkal_per_hari',label:'Energi pangan'},
  hunian:{key:'ruang_hunian_m2',label:'Luas hunian'},
  sanitasi:{key:'jamban_unit',label:'Jamban'},
};
export function categoryEstimate(shelters:Shelter[],category:NeedCategoryKey){
  const mapping=categoryMetrics[category];
  const rows=shelters.filter(s=>shelterReportsCategory(s,category));
  if(!mapping)return {total:rows.length,calculated:0,required:null,unit:'',label:''};
  const metric=metrics.find(m=>m.key===mapping.key)!;
  return {...metricSummary(rows,mapping.key),total:rows.length,unit:metric.unit,label:mapping.label};
}

export function NeedsCategoryTable({shelters,selectedCategory,onSelectCategory,onCalculate,busy=false}:{shelters:Shelter[];selectedCategory:NeedCategoryKey|null;onSelectCategory:(key:NeedCategoryKey)=>void;onCalculate?:()=>void;busy?:boolean}){
  const categories=categoryCounts(shelters).sort((a,b)=>b.count-a.count);
  return <section className="distribution-card category-summary-card" aria-label="Kebutuhan yang dilaporkan">
    <div className="distribution-header"><h3 className="category-summary-title">Kebutuhan yang dilaporkan</h3><span className="distribution-subtitle">{shelters.length} posko dalam rekap</span></div>
    <div className="category-summary-scroll" role="region" aria-label="Ringkasan kategori dan perkiraan kebutuhan" tabIndex={0}><table className="category-summary-table" aria-label="Jumlah posko per kategori kebutuhan">
      <thead><tr><th scope="col">Kebutuhan</th><th scope="col">Posko</th><th scope="col">Perkiraan kebutuhan</th><th scope="col">Aksi</th></tr></thead>
      <tbody>{categories.map(c=>{const estimate=categoryEstimate(shelters,c.key);return <tr key={c.key} className={selectedCategory===c.key?'category-selected':undefined}>
        <th scope="row">{c.label}</th>
        <td className="category-summary-count" aria-label={`${c.count} dari ${shelters.length} posko`}>{shelters.length?`${c.count} dari ${shelters.length}`:'—'}</td>
        <td className="category-estimate">{!c.count?<span className="category-summary-empty">—</span>:!estimate.label?<span className="category-summary-empty">Perlu rincian barang</span>:estimate.required===null?<span className="category-summary-empty">Belum dihitung</span>:<><strong>{estimate.required.toLocaleString('id-ID',{maximumFractionDigits:1})} {estimate.unit}</strong><small>{estimate.label}{estimate.calculated<estimate.total?` · ${estimate.calculated} dari ${estimate.total} posko dihitung`:''}</small></>}</td>
        <td>{c.count>0?<button type="button" className="category-summary-action" aria-label={`Lihat ${c.count} posko yang melaporkan ${c.label}`} aria-pressed={selectedCategory===c.key} onClick={()=>onSelectCategory(c.key)}>Lihat posko<ArrowRight size={15} aria-hidden="true"/></button>:<span className="category-summary-empty">{shelters.length?'Belum dilaporkan':'Belum ada data'}</span>}</td>
      </tr>;})}</tbody>
    </table></div>
    {onCalculate&&shelters.some(s=>!s.requirements)&&<button className="button secondary" disabled={busy} onClick={onCalculate}>{busy?'Menghitung…':'Hitung kebutuhan'}</button>}
    <p className="note">{shelters.length?'Acuan hasil hitung menjumlahkan posko yang melaporkan kategori tersebut; bukan permintaan bantuan yang sudah dikonfirmasi. Satu posko dapat melaporkan beberapa kebutuhan.':'Belum ada posko dalam rekap. Baca rekap tersimpan atau kirim laporan untuk memulai.'}</p>
  </section>;
}
