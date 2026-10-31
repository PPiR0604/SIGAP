import type {Shelter, RequirementKey} from './demo';

export const metrics: {key:RequirementKey;label:string;unit:string;basis:string}[] = [
  {key:'air_liter_per_hari',label:'Air bersih',unit:'L/hari',basis:'15 L/orang/hari'},
  {key:'kkal_per_hari',label:'Pangan (energi)',unit:'kkal/hari',basis:'2.100 kkal/orang/hari'},
  {key:'jamban_unit',label:'Jamban',unit:'unit',basis:'1 jamban per 20 orang, dibulatkan ke atas'},
  {key:'ruang_hunian_m2',label:'Ruang hunian',unit:'m²',basis:'3,5 m²/orang'},
];
const finite = (v:unknown):number|null => typeof v==='number'&&Number.isFinite(v)?v:null;
const village = (v:unknown) => !v||v==='Desa belum diketahui'?'':String(v);

export function applyCalculations(rows:Shelter[],data:any):Shelter[]{
  return rows.map(row=>{
    const matches=(data.shelters||[]).filter((s:any)=>s.shelter_name===row.name&&village(s.village)===village(row.village));
    if(matches.length!==1)return row;
    const result=matches[0];
    const requirements=Object.fromEntries(metrics.map(m=>[m.key,finite(result.needs?.[m.key]?.value)]));
    const shortages=Object.fromEntries(metrics.map(m=>[m.key,finite(result.gaps?.[m.key])]));
    const planning=result.planning?.schema_version==='sphere2018-population-v1'?result.planning:undefined;
    return {...row,requirements,shortages,planning,water:requirements.air_liter_per_hari,gap:shortages.air_liter_per_hari};
  });
}

export function metricValue(row:Shelter,key:RequirementKey,shortage=false):number|null{
  const values=shortage?row.shortages:row.requirements;
  if(values&&Object.hasOwn(values,key))return values[key]??null;
  return key==='air_liter_per_hari'?(shortage?row.gap:row.water):null;
}

export function recapCsv(rows:Shelter[],_key?:RequirementKey,storageLabel?:(row:Shelter)=>string):string{
  const unknown=(value:number|null|undefined)=>value??'Belum diketahui';
  const escape=(value:unknown)=>{const raw=String(value),s=/^[=+@\-\t\r]/.test(raw)?"'"+raw:raw;return /[",\r\n]/.test(s)?`"${s.replaceAll('"','""')}"`:s;};
  const groups=[['under5','Balita 0–4'],['children','Anak 5–17'],['adults','Dewasa'],['elderly','Lansia']] as const;
  const header=['Posko','Desa','Waktu laporan','Kebutuhan dilaporkan','Jiwa','Jumlah KK','Laki-laki','Perempuan','Balita 0–4 tahun','Anak 5–17 tahun','Lansia','Ibu hamil','Ibu menyusui','Disabilitas','Estimasi','Status pemeriksaan','Status penyimpanan',
    ...metrics.flatMap(m=>[`Acuan kebutuhan ${m.label} (${m.unit})`,`Kekurangan ${m.label} (${m.unit})`]),
    'Acuan protein (g/hari)','Acuan lemak (g/hari)','Skenario karbohidrat (g/hari)',
    ...groups.flatMap(([,label])=>[`${label} dalam alokasi (jiwa)`,`${label} alokasi air (L/hari)`,`${label} alokasi energi (kkal/hari)`])];
  const lines=rows.map(row=>{
    const planning=row.planning,age=(key:string)=>planning?.age_groups.find(g=>g.key===key);
    const quality=row.status==='Parsial'?'Data belum lengkap':row.status==='Siap ditinjau'?'Siap diperiksa':row.status;
    return [row.name,row.village,row.lastReportedAt||'Belum diketahui',row.needs.join('; ')||'Belum dilaporkan',unknown(row.people),unknown(row.totalFamilies),unknown(row.male),unknown(row.female),unknown(row.toddler),unknown(row.children),unknown(row.elderly),unknown(row.pregnant),unknown(row.breastfeeding),unknown(row.disability),row.estimate?'Ya':'Tidak dilaporkan',quality,storageLabel?.(row)||'Belum diketahui',
      ...metrics.flatMap(m=>[unknown(metricValue(row,m.key)),unknown(metricValue(row,m.key,true))]),
      unknown(planning?.nutrition.protein_g),unknown(planning?.nutrition.fat_g),unknown(planning?.nutrition.carbohydrate_equivalent_g),
      ...groups.flatMap(([key])=>[unknown(age(key)?.people),unknown(age(key)?.water_l),unknown(age(key)?.energy_kcal)])];
  });
  return [header,...lines].map(line=>line.map(escape).join(',')).join('\r\n');
}
