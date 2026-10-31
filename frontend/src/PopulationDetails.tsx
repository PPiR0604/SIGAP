import type {Shelter} from './demo';
const fields=[['people','Jumlah jiwa'],['male','Laki-laki'],['female','Perempuan'],['toddler','Balita (0–4 tahun)'],['children','Anak (5–17 tahun)'],['elderly','Lansia'],['pregnant','Ibu hamil'],['breastfeeding','Ibu menyusui'],['disability','Disabilitas'],['totalFamilies','Jumlah KK']] as const;
export function PopulationDetails({shelter}:{shelter:Shelter}){
 return <dl className="detail-grid population-details" aria-label="Rincian jiwa">{fields.map(([key,label])=><div key={key}><dt>{label}</dt><dd>{shelter[key]==null?'Belum diketahui':shelter[key]!.toLocaleString('id-ID')}</dd></div>)}</dl>;
}
