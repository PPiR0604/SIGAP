import {z} from 'zod';
const count=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const name=z.string().trim().min(1).max(200).refine(v=>!/[\r\n]/.test(v));
const metric=z.enum(['air_liter_per_hari','kkal_per_hari','jamban_unit','ruang_hunian_m2']);
const stamp=z.string().regex(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}$/).refine(v=>{try{return new Date(v.replace(' ','T')+'Z').toISOString().slice(0,16)===v.replace(' ','T');}catch{return false;}});
const clearField=z.enum(['total_people','total_families','male','female','infants_toddlers','children','elderly','pregnant','breastfeeding','disability','urgent_needs','stock','stock_context','notes']);
export const StructuredCorrectionSchema=z.object({
 target:z.object({report_id:z.string().regex(/^R\d+$/i),batch_id:z.string().min(1).max(150),name,village:name}).strict(),
 base_key:z.string().max(32000),
 changes:z.object({people:count.optional(),totalFamilies:count.optional(),male:count.optional(),female:count.optional(),toddler:count.optional(),children:count.optional(),elderly:count.optional(),pregnant:count.optional(),breastfeeding:count.optional(),disability:count.optional(),name:name.optional(),village:name.optional(),reportedAt:stamp.optional(),note:z.string().trim().max(4000).optional(),estimate:z.boolean().optional(),needs:z.array(name).min(1).max(100).optional(),stock:z.partialRecord(metric,z.number().finite().nonnegative()).optional(),stockContext:z.partialRecord(metric,z.object({unit:z.enum(['L','kkal','unit','m2']),recorded_at:stamp.optional(),horizon_hours:z.number().int().positive().max(8760).optional()}).strict()).optional(),clearFields:z.array(clearField).min(1).max(15).optional()}).strict().refine(v=>Object.keys(v).length>0)
}).strict().superRefine(({changes},ctx)=>{
 const units:Record<string,string>={air_liter_per_hari:'L',kkal_per_hari:'kkal',jamban_unit:'unit',ruang_hunian_m2:'m2'};
 for(const [key,context] of Object.entries(changes.stockContext||{})){
  if(changes.stock?.[key as keyof typeof changes.stock]===undefined)ctx.addIssue({code:'custom',path:['changes','stockContext',key],message:'Konteks stok memerlukan jumlah stok terkait.'});
  if(context.unit!==units[key])ctx.addIssue({code:'custom',path:['changes','stockContext',key,'unit'],message:'Satuan tidak sesuai metrik stok.'});
 }
 if(changes.stock?.jamban_unit!==undefined&&!Number.isSafeInteger(changes.stock.jamban_unit))ctx.addIssue({code:'custom',path:['changes','stock','jamban_unit'],message:'Jumlah jamban harus bilangan bulat yang valid.'});
 const canonical:Record<string,string>={people:'total_people',totalFamilies:'total_families',toddler:'infants_toddlers',needs:'urgent_needs',stockContext:'stock_context',note:'notes'};
 for(const field of changes.clearFields||[]){
  if(Object.keys(changes).some(key=>key!=='clearFields'&&changes[key as keyof typeof changes]!==undefined&&(canonical[key]||key)===field))ctx.addIssue({code:'custom',path:['changes','clearFields'],message:'Pilih perubahan nilai atau pengosongan untuk kolom yang sama.'});
 }
});
export type StructuredCorrection=z.infer<typeof StructuredCorrectionSchema>;
const mappings={people:['total_people','jumlah jiwa'],totalFamilies:['total_families','jumlah KK'],male:['male','laki-laki'],female:['female','perempuan'],toddler:['infants_toddlers','bayi/balita'],children:['children','anak'],elderly:['elderly','lansia'],pregnant:['pregnant','ibu hamil'],breastfeeding:['breastfeeding','ibu menyusui'],disability:['disability','disabilitas']} as const;
export function structuredCorrection(c:StructuredCorrection){
 const record:Record<string,unknown>={shelter_name:c.changes.name||c.target.name};
 const lines:string[]=[];
 for(const key of Object.keys(mappings) as (keyof typeof mappings)[]){const value=c.changes[key];if(value!==undefined){const [field,label]=mappings[key];record[field]=value;lines.push(`${label}: ${value}`);}}
 if(c.changes.name)lines.push(`ubah nama posko ini menjadi ${JSON.stringify(c.changes.name)}`);
 if(c.changes.village){record.village=c.changes.village;lines.push(`ubah desa posko ini menjadi ${JSON.stringify(c.changes.village)}`);}
 if(c.changes.needs){record.urgent_needs=c.changes.needs;lines.push(`ganti daftar kebutuhan yang dilaporkan hanya untuk posko ini menjadi: ${c.changes.needs.join('; ')}`);}
 if(c.changes.note){record.notes=c.changes.note;lines.push(c.changes.note);}
 if(c.changes.reportedAt){record.reported_at=c.changes.reportedAt;lines.push(`waktu laporan: ${c.changes.reportedAt}`);}
 if(c.changes.estimate!==undefined){record.is_estimate=c.changes.estimate;lines.push(c.changes.estimate?'Jumlah jiwa merupakan estimasi.':'Jumlah jiwa sudah dikonfirmasi.');}
 if(c.changes.stock){record.stock=c.changes.stock;record.stock_context=c.changes.stockContext||{};const labels:Record<string,string>={air_liter_per_hari:'air',kkal_per_hari:'pangan',jamban_unit:'jamban',ruang_hunian_m2:'ruang hunian'};const units:Record<string,string>={air_liter_per_hari:'L',kkal_per_hari:'kkal',jamban_unit:'unit',ruang_hunian_m2:'m2'};for(const [key,amount]of Object.entries(c.changes.stock)){const ctx=c.changes.stockContext?.[key as keyof typeof c.changes.stockContext];lines.push(`stok ${labels[key]}: ${amount} ${units[key]}${ctx?.horizon_hours?` untuk ${ctx.horizon_hours} jam`:''}${ctx?.recorded_at?` dicatat ${ctx.recorded_at.slice(8,10)}/${ctx.recorded_at.slice(5,7)}/${ctx.recorded_at.slice(0,4)} ${ctx.recorded_at.slice(11)}`:''}`);}}
 for(const field of c.changes.clearFields||[])lines.push(`Usulkan pengosongan field: ${field}`);
 return {record,text:`Mohon klarifikasi laporan ${c.target.report_id} (${c.target.name}) batch ${c.target.batch_id}: ${lines.join('.\n')}.`};
}
const keys=['total_people','total_families','male','female','elderly','disability','infants_toddlers','children','pregnant','breastfeeding','is_estimate','stock','stock_context','urgent_needs','unverified_numbers','validation_issues','reported_at'];
const stable=(v:any):any=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
export function correctionBaseKey(record:Record<string,unknown>){return JSON.stringify(stable(Object.fromEntries(keys.map(k=>[k,record[k]??null]))));}
