import {useEffect,useId,useState} from 'react';
import type {Shelter} from './demo';
import type {ClarificationChanges} from './ClarificationForm';
import {HelpTip} from './HelpTip';
import {ChevronDown} from 'lucide-react';
const metrics=[['air_liter_per_hari','Air bersih','L'],['kkal_per_hari','Energi pangan','kkal'],['jamban_unit','Jamban','unit'],['ruang_hunian_m2','Ruang hunian','m2']] as const;
const stockGuides={
 air_liter_per_hari:'Total air yang tersedia, dalam liter. Contoh: 2 tandon berisi 1.000 L = 2.000 L.',
 kkal_per_hari:'Total energi dari stok makanan, dalam kkal. Bukan berat bahan pangan; gunakan informasi gizi atau hasil konversi yang terverifikasi.',
 jamban_unit:'Jumlah jamban yang berfungsi dan dapat digunakan pengungsi. Jangan hitung yang rusak.',
 ruang_hunian_m2:'Total luas hunian yang dapat dipakai pengungsi, dalam m². Bukan jumlah tenda.',
};
export function StockEditor({shelter,extra,onChange,onError,section,focusField,focusRevision=0}:{section?:'data'|'stock'|'notes';focusField?:string;focusRevision?:number;shelter:Shelter;extra:ClarificationChanges;onChange:(value:ClarificationChanges)=>void;onError:(error:string)=>void}){
 const guideId=useId();
 const [activeMetric,setActiveMetric]=useState<string>('air_liter_per_hari');
 useEffect(()=>{if(metrics.some(([key])=>key===focusField))setActiveMetric(focusField!);},[focusField,focusRevision]);
 const [values,setValues]=useState<Record<string,string>>(()=>Object.fromEntries(metrics.flatMap(([key])=>{const ctx=extra.stockContext?.[key]||shelter.stockContext?.[key];return [[key,String(extra.stock?.[key]??shelter.stock?.[key]??'')],[key+'-time',ctx?.recorded_at?.replace(' ','T').slice(0,16)||''],[key+'-hours',String(ctx?.horizon_hours??'')]];})));
 const [error,setError]=useState('');
 function update(key:string,value:string){const next={...values,[key]:value};setValues(next);const stock:ClarificationChanges['stock']={},context:NonNullable<Shelter['stockContext']>={};let issue='';for(const [k,label,unit]of metrics){if(!next[k].trim()){if(next[k+'-hours']||next[k+'-time'])issue=`Isi jumlah stok ${label.toLowerCase()} sebelum mengisi waktunya.`;continue;}const n=Number(next[k]),h=next[k+'-hours'],time=next[k+'-time'];if(!Number.isFinite(n)||n<0||(k==='jamban_unit'&&!Number.isSafeInteger(n)))issue=`Stok ${label.toLowerCase()} harus nol atau lebih${k==='jamban_unit'?' dan berupa bilangan bulat':''}.`;if(h&&(!Number.isSafeInteger(Number(h))||Number(h)<=0||Number(h)>8760))issue='Periode stok harus bilangan bulat 1–8760 jam.';stock[k]=n;context[k]={unit,...(time?{recorded_at:time.replace('T',' ')}:{}),...(h?{horizon_hours:Number(h)}:{})};}setError(issue);onError(issue);if(!issue)onChange({...extra,stock,stockContext:context});}
 const clear=extra.clearFields||[];
 return <div className="clarification-section">
  <div className="clarification-report-meta" hidden={!!section&&section!=='data'}><h4>Waktu laporan & estimasi</h4>
  <div className="stock-guide-field"><div className="field-label-row"><label className="field-label" htmlFor="clarification-reportedAt">Waktu laporan</label><HelpTip label="Panduan waktu laporan"><p id={`${guideId}-reported-help`}>Kapan kondisi posko ini dilaporkan, bukan waktu Anda mengisi formulir.</p></HelpTip></div><input id="clarification-reportedAt" type="datetime-local" aria-describedby={`${guideId}-reported-help`} value={extra.reportedAt?.replace(' ','T')||shelter.reportedAt?.replace(' ','T').slice(0,16)||''} onChange={e=>onChange({...extra,reportedAt:e.target.value.replace('T',' ')||undefined})}/></div>
  <div className="field-label-row"><label className="checkbox-row"><input type="checkbox" aria-describedby={`${guideId}-estimate-help`} checked={extra.estimate??!!shelter.estimate} onChange={e=>onChange({...extra,estimate:e.target.checked})}/>Jumlah jiwa merupakan estimasi</label><HelpTip label="Panduan jumlah estimasi"><p id={`${guideId}-estimate-help`}>Centang jika jumlah jiwa masih perkiraan dan belum selesai didata.</p></HelpTip></div>
  </div><div hidden={!!section&&section!=='stock'}><h4>Stok tersedia</h4>{section&&<div className="clarification-section-tabs" role="group" aria-label="Jenis stok">{metrics.map(([key,label])=><button type="button" key={key} aria-pressed={activeMetric===key} onClick={()=>setActiveMetric(key)}>{label}</button>)}</div>}<p className="stock-entry-guide"><strong>0 = tidak tersedia.</strong> Kosong tidak menghapus data lama.</p>
  {metrics.map(([key,label,unit])=>{
   const daily=key==='air_liter_per_hari'||key==='kkal_per_hari';
   const fields=[
    {field:key,name:`Stok ${label.toLowerCase()}`,type:'number',help:stockGuides[key]},
    {field:key+'-time',name:`Waktu stok ${label.toLowerCase()}`,type:'datetime-local',help:'Kapan stok ini terakhir dihitung di lapangan. Bukan tanggal kedaluwarsa.'},
    ...(daily?[{field:key+'-hours',name:`Periode stok ${label.toLowerCase()} (jam)`,type:'number',help:'Jangka waktu yang dicakup jumlah stok ini. 24 jam = 1 hari; 48 jam = 2 hari. Bukan berapa jam sejak stok dihitung.'}]:[]),
   ];
   const hours=values[key+'-hours'];
   return <fieldset className="stock-editor" key={key} hidden={!!section&&activeMetric!==key}>
    <legend>{label} ({unit==='m2'?'m²':unit})</legend>
    <div className="clarification-grid">{fields.map(({field,name,type,help})=>{
     const id=`${guideId}-${field}`;
     return <div className="stock-guide-field" key={field}><div className="field-label-row"><label className="field-label" htmlFor={id}>{name}</label><HelpTip label={`Panduan ${name.toLocaleLowerCase('id-ID')}`}><p id={`${id}-help`}>{help}</p>{field===key+'-hours'&&<p>Perhitungan kekurangan memakai acuan 24 jam. Isi periode sesuai laporan sumber.</p>}</HelpTip></div><input id={id} data-stock-field={field} type={type} min={type==='number'?(field===key?0:1):undefined} max={field===key+'-hours'?8760:undefined} step={field===key&&key!=='jamban_unit'?'any':1} aria-describedby={`${id}-help`} value={values[field]} onChange={e=>update(field,e.target.value)}/></div>;
    })}</div>
    {daily&&hours&&Number(hours)!==24&&<p className="stock-period-guide"><strong>Periode {hours} jam:</strong> kekurangan belum dapat dihitung; acuan saat ini 24 jam.</p>}
   </fieldset>;
  })}
  {error&&<p className="field-error" role="status">{error}</p>}</div><div hidden={!!section&&section!=='notes'}>
  <details className="clarification-disclosure"><summary>Usulkan pengosongan data<ChevronDown size={16} aria-hidden="true"/></summary><p>Usulan belum menghapus nilai. Pilih kosongkan, pertahankan, atau tunda pada tahap persetujuan.</p>{['total_people','total_families','male','female','infants_toddlers','children','elderly','pregnant','breastfeeding','disability','urgent_needs','stock','stock_context'].map(field=><label className="clear-proposal" key={field}><input type="checkbox" checked={clear.includes(field)} onChange={e=>onChange({...extra,clearFields:e.target.checked?[...clear,field]:clear.filter(f=>f!==field)})}/>{({total_people:'Jumlah jiwa',total_families:'Jumlah KK',male:'Laki-laki',female:'Perempuan',infants_toddlers:'Bayi/balita',children:'Anak',elderly:'Lansia',pregnant:'Ibu hamil',breastfeeding:'Ibu menyusui',disability:'Disabilitas',urgent_needs:'Daftar kebutuhan',stock:'Seluruh stok',stock_context:'Waktu dan periode stok'} as Record<string,string>)[field]}</label>)}</details></div>
 </div>;
}
