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
    return {...row,requirements,shortages,water:requirements.air_liter_per_hari,gap:shortages.air_liter_per_hari};
  });
}

export function metricValue(row:Shelter,key:RequirementKey,shortage=false):number|null{
  const values=shortage?row.shortages:row.requirements;
  if(values&&Object.hasOwn(values,key))return values[key]??null;
  return key==='air_liter_per_hari'?(shortage?row.gap:row.water):null;
}

export function recapCsv(rows:Shelter[],key?:RequirementKey):string{
  const metric=metrics.find(m=>m.key===key);
  const unknown=(value:number|null)=>value??'Belum diketahui';
  const escape=(value:unknown)=>{const s=String(value);return /[",\r\n]/.test(s)?`"${s.replaceAll('"','""')}"`:s;};
  const header=['Posko','Desa','Kebutuhan dilaporkan',...(metric?[`Kebutuhan ${metric.label} (${metric.unit})`,`Kekurangan (${metric.unit})`]:['Jiwa','Status'])];
  const lines=rows.map(row=>[row.name,row.village,row.needs.join('; ')||'Belum dilaporkan',...(key?[unknown(metricValue(row,key)),unknown(metricValue(row,key,true))]:[unknown(row.people),row.status])]);
  return [header,...lines].map(line=>line.map(escape).join(',')).join('\n');
}
