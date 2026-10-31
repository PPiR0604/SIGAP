import type {Shelter} from './demo';
import {HelpTip} from './HelpTip';
import {reviewFieldLabel} from './reviewIndicators';
export function FieldSource({shelter,field}:{shelter:Shelter;field:string}){const p=shelter.provenance?.[field];if(!p)return null;return <HelpTip source label={`Sumber ${reviewFieldLabel(field).toLocaleLowerCase('id-ID')}`}><p>{p.source_excerpt||(typeof p.evidence==='string'?p.evidence:p.evidence?JSON.stringify(p.evidence):'Kutipan sumber belum tersedia.')}</p><small>{p.reported_at||'Waktu sumber belum tersedia'}</small></HelpTip>;}
