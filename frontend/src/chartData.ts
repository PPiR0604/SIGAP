import type {RequirementKey, Shelter} from './demo';
import {metricValue} from './needs';

export const needCategories = [
  {key:'air',label:'Air bersih',color:'#2563eb',pattern:/air|tandon|tangki|water/i},
  {key:'pangan',label:'Pangan',color:'#d97706',pattern:/pangan|makanan|sembako|beras|dapur|gizi|susu|roti|konsumsi|minyak/i},
  {key:'hunian',label:'Tenda & hunian',color:'#059669',pattern:/tenda|terpal|shelter|selimut|matras|alas|hunian/i},
  {key:'sanitasi',label:'Sanitasi',color:'#0891b2',pattern:/sanitasi|mck|jamban|toilet|sabun|kebersihan|pembalut|popok/i},
  {key:'medis',label:'Medis',color:'#be185d',pattern:/medis|obat|kesehatan|p3k|dokter|perban|balut|farmasi/i},
  {key:'lainnya',label:'Lainnya',color:'#64748b',pattern:null},
] as const;
export type NeedCategoryKey=typeof needCategories[number]['key'];
export type RekapFocus={status?:'Perlu klarifikasi'|'Parsial'|'Siap ditinjau';category?:NeedCategoryKey;metric?:RequirementKey};

/** Shared by the summary and its drill-down so counts and filtered rows agree. */
function reportedCategories(shelter:Pick<Shelter,'needs'>){
  const keys=new Set<NeedCategoryKey>();
  for(const item of shelter.needs.filter(item=>item.trim())){
    const matches=needCategories.filter(category=>category.pattern?.test(item));
    for(const category of matches.length?matches:[needCategories.at(-1)!])keys.add(category.key);
  }
  return keys;
}
export const shelterReportsCategory=(shelter:Pick<Shelter,'needs'>,key:NeedCategoryKey)=>reportedCategories(shelter).has(key);

export const shelterKey=(s:Shelter)=>JSON.stringify([s.sourceBatchId,s.id,s.name,s.village]);
const known=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>=0;

/** One shelter counts once per category, even if several reported items match. */
export function categoryCounts(shelters:Shelter[]){
  const counts=needCategories.map(category=>({...category,count:0}));
  for(const shelter of shelters){
    const keys=reportedCategories(shelter);
    for(const category of counts)if(keys.has(category.key))category.count++;
  }
  const total=counts.reduce((sum,item)=>sum+item.count,0);
  return counts.map(item=>({...item,percent:total?item.count/total*100:0}));
}

/** Ratios visualize server calculations; they never substitute missing stock or needs. */
export function metricSummary(shelters:Shelter[],key:RequirementKey){
  let required=0,calculated=0,paired=0,pairedRequired=0,shortage=0;
  for(const shelter of shelters){
    const need=metricValue(shelter,key),gap=metricValue(shelter,key,true);
    if(!known(need))continue;
    required+=need;calculated++;
    if(known(gap)&&gap<=need){paired++;pairedRequired+=need;shortage+=gap;}
  }
  return {required:calculated?required:null,calculated,paired,shortage:paired?shortage:null,
    fulfillment:pairedRequired>0?(pairedRequired-shortage)/pairedRequired*100:null};
}

export function groupByArea(shelters:Shelter[]){
  const groups=new Map<string,Shelter[]>();
  for(const shelter of shelters){
    const area=shelter.subdistrict?.trim()||shelter.village?.trim()||'Wilayah belum diketahui';
    groups.set(area,[...(groups.get(area)||[]),shelter]);
  }
  return [...groups].map(([name,rows])=>({name,rows,categories:categoryCounts(rows)}));
}

export function vulnerableGroups(shelter?:Shelter){
  const groups=[
    {label:'Balita',value:shelter?.toddler,color:'#2563eb'},
    {label:'Lansia',value:shelter?.elderly,color:'#d97706'},
    {label:'Ibu hamil',value:shelter?.pregnant,color:'#be185d'},
    {label:'Disabilitas',value:shelter?.disability,color:'#7c3aed'},
  ];
  const total=shelter?.people;
  return groups.map(group=>({...group,value:known(group.value)?group.value:null,
    percent:known(group.value)&&known(total)&&total>0&&group.value<=total?group.value/total*100:
      group.value===0&&total===0?0:null,
    inconsistent:known(group.value)&&known(total)&&group.value>total}));
}
