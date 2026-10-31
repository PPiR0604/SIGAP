import type {Shelter} from './demo';
import {metrics,metricValue} from './needs';
import {sphereReference} from './spherePlanning';
import {HelpTip} from './HelpTip';
import {ChevronDown} from 'lucide-react';
const number=(value:number|null|undefined)=>typeof value==='number'&&Number.isFinite(value)?value.toLocaleString('id-ID',{maximumFractionDigits:1}):'Belum diketahui';
const labels={under5:'Balita (0–4 tahun)',children:'Anak (5–17 tahun)',adults:'Dewasa (sisa total)',elderly:'Lansia'};
export function SphereNeedsDetails({shelter,onCalculate,canCalculate=false,busy=false,onClarify}:{shelter:Shelter;onCalculate?:()=>void;canCalculate?:boolean;busy?:boolean;onClarify?:()=>void}){
 const p=shelter.planning;
 return <section className="sphere-needs-details" aria-label="Rincian kebutuhan Sphere">
  <div className="field-label-row"><h3>Kebutuhan hasil perhitungan</h3><HelpTip label="Panduan hasil perhitungan"><p>Acuan awal untuk seluruh populasi posko, berdasarkan {shelter.estimate?'jumlah jiwa estimasi':'jumlah jiwa terdata'}. Ini perkiraan kebutuhan; kekurangan baru diketahui jika stok dan waktunya sesuai.</p></HelpTip></div>
  {shelter.estimate&&<p className="sphere-caption">Dihitung dari jumlah jiwa estimasi.</p>}
  <dl className="detail-grid sphere-total-needs">{metrics.map(m=>{
   const need=metricValue(shelter,m.key);
   const gap=metricValue(shelter,m.key,true);
   const absGap=gap!==null?Math.abs(gap):null;
   return <div key={m.key} className="sphere-need-item">
    <dt>{m.label}</dt>
    <dd>
     <div className="sphere-need-value">{need===null?'Belum diketahui':`${number(need)} ${m.unit}`}</div>
     <div className={`sphere-gap-badge ${gap===null?'gap-unknown':absGap===0?'gap-fulfilled':'gap-deficit'}`}>
      {gap===null?'Kekurangan: Stok belum dicatat':absGap===0?`Terpenuhi (kekurangan 0 ${m.unit})`:`Kekurangan: ${number(absGap)} ${m.unit}`}
     </div>
    </dd>
   </div>;
  })}</dl>
  {!p?<div className="sphere-unavailable"><p>Rincian makro dan kelompok usia belum dihitung.</p>{onCalculate&&<button type="button" className="button secondary" disabled={busy||!canCalculate} onClick={onCalculate}>{busy?'Sedang menghitung…':'Hitung kebutuhan rinci'}</button>}{!canCalculate&&<p>Hubungkan backend untuk menghitung dari sumber posko.</p>}</div>:<>
   <div className="field-label-row"><h4>Pangan dan makronutrien</h4><HelpTip label="Panduan makronutrien"><p>Protein dan lemak mengikuti acuan populasi Sphere. Karbohidrat adalah skenario sisa energi pada acuan tersebut, bukan target tersendiri dari Sphere.</p></HelpTip></div>
   <dl className="sphere-macro-grid">{[['Protein (acuan minimum)',p.nutrition.protein_g],['Lemak (acuan minimum)',p.nutrition.fat_g],['Karbohidrat (ekuivalen)',p.nutrition.carbohydrate_equivalent_g]].map(([label,value])=><div key={String(label)}><dt>{label}</dt><dd>{value==null?'Belum diketahui':`${number(value as number)} g/hari`}</dd></div>)}</dl>
   <p className="sphere-caption">Karbohidrat: skenario, bukan target Sphere.</p>
   <div className="field-label-row"><h4>Alokasi acuan per kelompok usia</h4><HelpTip label="Panduan alokasi usia dan air"><p>Ransum balita, ibu hamil/menyusui, dan lansia perlu penilaian gizi tersendiri.</p><p>Ibu hamil/menyusui dan disabilitas termasuk dalam kelompok usia, tidak ditambahkan lagi. Air domestik mencakup minum, masak, dan kebersihan; bukan jatah air minum individu.</p><p>Dewasa adalah sisa total setelah balita, anak, dan lansia; hanya dihitung jika rincian usia lengkap dan konsisten.</p></HelpTip></div>
   <p className="sphere-allocation-note">Acuan populasi, <strong>bukan kebutuhan gizi khusus usia</strong>.</p>
   <div className="sphere-age-table" role="region" aria-label="Alokasi air dan pangan per kelompok usia" tabIndex={0}><table><thead><tr><th scope="col">Kelompok</th><th scope="col">Jiwa</th><th scope="col">Air domestik<br/><small>L/hari</small></th><th scope="col">Alokasi energi<br/><small>kkal/hari</small></th></tr></thead><tbody>{p.age_groups.map(row=><tr key={row.key}><th scope="row">{labels[row.key]}</th><td>{number(row.people)}</td><td>{number(row.water_l)}</td><td>{number(row.energy_kcal)}</td></tr>)}</tbody>{p.complete_age_counts&&<tfoot><tr><th scope="row">Total posko</th><td>{number(shelter.people)}</td><td>{number(metricValue(shelter,'air_liter_per_hari'))}</td><td>{number(p.nutrition.energy_kcal)}</td></tr></tfoot>}</table></div>
   {p.issues.length>0&&<div className="sphere-data-issues"><strong>Rincian usia perlu diperiksa</strong><ul>{p.issues.map(issue=><li key={issue}>{issue}</li>)}</ul>{onClarify&&<button type="button" className="button secondary" disabled={busy} onClick={onClarify}>Lengkapi rincian usia</button>}</div>}
  </>}
  <details className="sphere-method clarification-disclosure"><summary>Dasar hitung dan batas penggunaan<ChevronDown size={16} aria-hidden="true"/></summary><p>Sphere 2018: air domestik minimum 15 L/orang/hari (hlm. 105–107); energi rata-rata populasi 2.100 kkal/orang/hari (standar 6.1); protein 53 g dan lemak 40 g/orang/hari (Lampiran 6, hlm. 231).</p><p>Karbohidrat ekuivalen = (2.100 − 4 × 53 − 9 × 40) ÷ 4 = 382 g/orang/hari. Ini skenario komposisi energi, bukan standar minimum karbohidrat. Angka tidak langsung setara kilogram beras atau menu makanan.</p><p>Dewasa = total − balita − anak 5–17 − lansia. Dihitung hanya jika angka lengkap dan tidak melebihi total. Kebutuhan menurut usia, kondisi kesehatan, iklim, aktivitas, dan makanan yang sudah tersedia perlu asesmen serta penyesuaian.</p><a href={`${sphereReference}#page=260`} target="_blank" rel="noopener noreferrer">Baca acuan Sphere 2018</a></details>
 </section>;
}
