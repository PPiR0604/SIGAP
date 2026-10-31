import type {Shelter} from './demo';
import {matchesClarificationTarget} from './backendPreview';

const fields: [keyof Shelter,string][]=[['name','Nama posko'],['village','Desa'],['subdistrict','Kecamatan'],['totalFamilies','Jumlah KK'],['children','Anak'],['breastfeeding','Ibu menyusui'],['reportedAt','Waktu laporan'],['stock','Stok'],['stockContext','Waktu dan periode stok'],['people','Jumlah jiwa'],['male','Laki-laki'],['female','Perempuan'],['elderly','Lansia'],['disability','Disabilitas'],['toddler','Balita'],['pregnant','Ibu hamil'],['needs','Kebutuhan dilaporkan']];
const stockLabels:Record<string,[string,string]>={air_liter_per_hari:['Air bersih','L'],kkal_per_hari:['Energi pangan','kkal'],jamban_unit:['Jamban','unit'],ruang_hunian_m2:['Ruang hunian','m²']};
function format(value:unknown,key?:keyof Shelter):string{
 if(value==null||value==='')return 'Belum diketahui';
 if(Array.isArray(value))return value.join(', ')||'Belum dilaporkan';
 if((key==='stock'||key==='stockContext')&&typeof value==='object')return Object.entries(value).map(([metric,v])=>{
  const [label,unit]=stockLabels[metric]||['Stok lain',''];
  if(key==='stock')return `${label}: ${v==null?'belum diketahui':`${Number(v).toLocaleString('id-ID')} ${unit}`}`;
  const context=v as {recorded_at?:string;horizon_hours?:number}|null;
  return `${label}: ${context?.recorded_at||'waktu belum diketahui'}${context?.horizon_hours?` · ${context.horizon_hours} jam`:''}`;
 }).join('; ')||'Belum dilaporkan';
 return typeof value==='object'?JSON.stringify(value):String(value);
}
export function changesFor(old:Shelter,next:Shelter){return fields.flatMap(([key,label])=>format(old[key],key)===format(next[key],key)?[]:[{label,before:format(old[key],key),after:format(next[key],key)}]);}
export function ChangeSummary({before,after}:{before:Shelter[];after:Shelter[]}){
 if(!after.length)return null;
 return <section className="change-summary" aria-label="Ringkasan perubahan"><h3>Perubahan yang akan disimpan</h3><p className="note">Bandingkan dengan rekap tersimpan. Keputusan konflik di bawah tetap menentukan nilai yang disimpan.</p>{after.map((next,i)=>{const matches=before.filter(old=>matchesClarificationTarget(next,old));if(matches.length!==1)return <p key={i}><strong>{next.name}</strong> · {matches.length?'Target lama ambigu; periksa rujukan posko.':next.correctionTarget?'Data lama belum tersedia untuk dibandingkan.':'Posko baru; periksa seluruh data di pratinjau.'}</p>;const changes=changesFor(matches[0],next);return <div key={i}><h4>{next.name}</h4>{changes.length?<div className="markdown-table" role="region" aria-label={`Perubahan ${next.name}`} tabIndex={0}><table><thead><tr><th>Data</th><th>Tersimpan</th><th>Usulan baru</th></tr></thead><tbody>{changes.map(c=><tr key={c.label}><th scope="row">{c.label}</th><td>{c.before}</td><td>{c.after}</td></tr>)}</tbody></table></div>:<p>Tidak ada perubahan pada identitas, jumlah jiwa, atau kebutuhan yang dilaporkan.</p>}</div>;})}</section>;
}
