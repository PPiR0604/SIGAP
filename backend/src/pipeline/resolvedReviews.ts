import {isDeepStrictEqual} from 'node:util';

const counts=['total_people','total_families','male','female','infants_toddlers','children','elderly','pregnant','breastfeeding','disability'];
const units={air_liter_per_hari:'L',kkal_per_hari:'kkal',jamban_unit:'unit',ruang_hunian_m2:'m2'};
const text=(v:unknown)=>String(v??'').trim();
const place=(v:unknown)=>text(v).toLowerCase().replace(/\s+/g,' ');
const name=(v:unknown)=>place(v).replace(/^posko\s+/,'');
const stamp=(v:unknown)=>text(v).replace('T',' ').slice(0,16)||null;
const needs=(v:any)=>Array.isArray(v)?v.map(item=>typeof item==='string'
  ?{item:item.trim().toLowerCase(),qty:null,unit:null}
  :{item:text(item.item).toLowerCase(),qty:item.qty??null,unit:item.unit||null})
  .sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))):[];

function values(record:any){
  return {...Object.fromEntries(counts.map(key=>[key,record[key]??null])),
    shelter_type:record.shelter_type||null,reported_at:stamp(record.reported_at),is_estimate:record.is_estimate===true,
    urgent_needs:needs(record.urgent_needs),surplus_do_not_send:needs(record.surplus_do_not_send),notes:text(record.notes),
    stock:Object.fromEntries(Object.entries(units).map(([key,unit])=>[key,{value:record.stock?.[key]??null,
      unit:record.stock_context?.[key]?.unit||unit,recorded_at:stamp(record.stock_context?.[key]?.recorded_at),
      horizon_hours:record.stock_context?.[key]?.horizon_hours??null}]))};
}

/** Retire only redundant drafts whose complete operational values already exist in a fresh read. */
export function reviewAlreadyStored(records:any[],stored:any[]):boolean {
  return records.length>0&&records.every(record=>{
    if(['pending_clear_fields','validation_issues','unverified_numbers','stock_issues','storage_issues','storage_conflicts']
      .some(key=>Array.isArray(record[key])&&record[key].length))return false;
    if(!name(record.shelter_name)||!place(record.village))return false;
    const matches=stored.filter(row=>{
      if(text(row.disaster_id)!==text(record.disaster_id))return false;
      if(name(row.shelter_name)!==name(record.shelter_name)||place(row.village)!==place(record.village))return false;
      // A provisional new-shelter ID may differ from the one allocated by another
      // approved copy. Existing shelter IDs must still match exactly.
      if(record.shelter_id&&row.shelter_id&&record.shelter_id!==row.shelter_id)
        return !record.update_target&&record.storage_baseline?.row===null;
      return true;
    });
    return matches.length===1&&isDeepStrictEqual(values(record),values(matches[0]));
  });
}
