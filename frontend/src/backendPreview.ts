import type { Shelter } from './demo';
import {reviewIndicators} from './reviewIndicators';

export type Preview = { records?: Record<string, any>[]; issues?: any[]; snapshot_id?: string; simulated?: boolean; superseded_snapshot_ids?:string[] };
const stable = (value:any):any => Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
function calculationKey(record:Record<string,any>):string {
  const keys=['total_people','male','female','elderly','disability','infants_toddlers','children','pregnant','breastfeeding','is_estimate','stock','stock_context','urgent_needs','unverified_numbers','validation_issues','reported_at'];
  return JSON.stringify(stable(Object.fromEntries(keys.map(key=>[key,record[key]??null]))));
}

/** Carry only calculations whose source inputs are unchanged; never reuse a changed village's figures. */
export function retainUnchangedCalculations(previous:Shelter[], next:Shelter[]):Shelter[]{
  return next.map(row=>{
    const matches=previous.filter(old=>old.name===row.name&&old.village===row.village);
    const old=matches.length===1?matches[0]:undefined;
    if(!old?.calculationKey||old.calculationKey!==row.calculationKey)return row;
    return {...row,requirements:old.requirements,shortages:old.shortages,water:old.water,gap:old.gap};
  });
}
export function pendingClearFields(preview: Preview): { reportId: string; field: string }[] {
  return (preview.records || []).flatMap(r => (r.pending_clear_fields || []).map((field: string) => ({ reportId: r.report_id, field })));
}

/** Corrections may change display names/villages. Prefer server-bound references. */
export function matchesClarificationTarget(candidate:Shelter,original:Shelter):boolean{
  const targets=[candidate.correctionTarget,...(candidate.candidateLineage||[])].filter((ref):ref is {batch_id:string;report_id:string}=>!!ref?.batch_id&&!!ref.report_id);
  const originals=[original.sourceBatchId?{batch_id:original.sourceBatchId,report_id:original.id}:undefined,original.correctionTarget,...(original.candidateLineage||[])].filter((ref):ref is {batch_id:string;report_id:string}=>!!ref?.batch_id&&!!ref.report_id);
  if(targets.length)return targets.some(target=>originals.some(ref=>target.batch_id===ref.batch_id&&target.report_id===ref.report_id));
  // Minimal/mock candidates without a target retain exact location matching.
  return candidate.name===original.name&&candidate.village===original.village;
}
export function previewRows(preview: Preview): Shelter[] {
  return (preview.records || []).map((r, index) => {
    const missing = r.missing_fields?.length || r.total_people == null;
    const issues = (r.validation_issues || []).map((issue: any) => typeof issue === 'string' ? issue : issue.reason || issue.detail || 'Perlu klarifikasi');
    const hasConflict = !!r.storage_conflicts?.length;
    const needsClarification = (r.validation_issues || []).some((issue:any) => typeof issue === 'string' || issue.field !== 'storage_conflicts') || r.pending_clear_fields?.length || r.stock_issues?.length || r.storage_issues?.length || r.unverified_numbers?.length || (r.total_people != null && r.male != null && r.female != null && r.male + r.female !== r.total_people);
    const source = Object.values(r.field_provenance || {}).map((p: any) => p.source_excerpt || p.evidence).filter((x: any) => typeof x === 'string');
    return { reviewItems:reviewIndicators(r),calculationKey:calculationKey(r), id: r.report_id || `record-${index}`, sourceBatchId:r.batch_id,
      correctionTarget:r.update_target?{batch_id:r.update_target.batch_id,report_id:r.update_target.report_id}:undefined,
      candidateLineage:Array.isArray(r.candidate_lineage)?r.candidate_lineage.filter((ref:any)=>typeof ref?.batch_id==='string'&&typeof ref?.report_id==='string').map((ref:any)=>({batch_id:ref.batch_id,report_id:ref.report_id})):undefined,
      name: r.shelter_name || 'Nama belum diketahui', village: r.village || 'Desa belum diketahui',
      people: r.total_people ?? null, male: r.male ?? null, female: r.female ?? null, elderly: r.elderly ?? null, disability: r.disability ?? null,
      status: needsClarification ? 'Perlu klarifikasi' : hasConflict ? 'Menunggu persetujuan' : missing ? 'Parsial' : 'Siap ditinjau',
      needs: (r.urgent_needs || []).map((n: any) => typeof n === 'string' ? n : n.item || n.name || n.category || 'Kebutuhan perlu diperiksa'),
      time: r.reported_at || 'Waktu belum diketahui', source: [...new Set(source)].join('\n') || 'Rujuk bukti sumber pada hasil validasi server.',
      water: null, gap: null, note: hasConflict && !needsClarification ? 'Koreksi sudah diterapkan pada pratinjau, belum disimpan. Pilih nilai lama atau baru melalui Tinjau & simpan perubahan.' : issues.join(' ') || (missing ? 'Sebagian data belum diketahui.' : 'Periksa sebelum menyetujui.'), estimate: r.is_estimate === true };
  });
}

const pick = (r: Record<string, any>, keys: string[]) => keys.map(k => r[k]).find(v => v !== undefined && v !== null && v !== '');
const toNumber = (v: unknown): number | null => {
  if (v === undefined || v === null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const toNeeds = (v: unknown): any[] => Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,;\n]/).map(x => x.trim()).filter(Boolean) : [];

/** Baris rekap dari data yang sudah tersimpan (bukan kandidat): nama kolom sheet yang umum dipetakan ke bentuk kandidat. */
export function storedRows(records: Record<string, any>[] = []): Shelter[] {
  const normalized = records.filter(r => r && typeof r === 'object').map(r => ({
    ...r,
    batch_id:r.batch_id,
    report_id: pick(r, ['report_id', 'id_laporan', 'id', 'shelter_id']),
    shelter_name: pick(r, ['shelter_name', 'nama_posko', 'posko', 'name']),
    village: pick(r, ['village', 'desa', 'kelurahan']),
    total_people: toNumber(pick(r, ['total_people', 'jumlah_jiwa', 'jiwa', 'total'])),
    male: toNumber(pick(r, ['male', 'laki_laki'])),
    female: toNumber(pick(r, ['female', 'perempuan'])),
    elderly: toNumber(pick(r, ['elderly', 'lansia'])),
    disability: toNumber(pick(r, ['disability', 'disabilitas'])),
    urgent_needs: toNeeds(pick(r, ['urgent_needs', 'needs', 'kebutuhan'])),
    reported_at: pick(r, ['reported_at', 'updated_at', 'waktu', 'timestamp']),
    is_estimate: r.is_estimate,
    validation_issues: r.validation_issues
  }));
  return previewRows({ records: normalized }).map(row => ({
    ...row,
    source: 'Dibaca dari rekap yang sudah tersimpan.',
    note: row.status === 'Parsial' ? 'Sebagian data belum diketahui di rekap tersimpan.' : 'Dari rekap tersimpan. Belum ada kandidat baru.'
  }));
}

const normName = (name: string) => name.toLowerCase().replace(/\bposko\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const UNKNOWN_VILLAGE = 'Desa belum diketahui', UNKNOWN_TIME = 'Waktu belum diketahui';
const fields: [keyof Shelter, string][] = [['people', 'jiwa'], ['male', 'laki-laki'], ['female', 'perempuan'], ['elderly', 'lansia'], ['disability', 'disabilitas']];

/**
 * Gabungkan kandidat (mis. koreksi satu posko) ke rekap tersimpan. Posko lain tetap seperti tersimpan,
 * field yang tidak disebut kandidat memakai nilai tersimpan, dan perubahan dicatat di `changes`.
 * Pencocokan lewat nama posko: ID laporan baru bisa bertabrakan dengan ID tersimpan.
 */
export function mergeCandidateOntoStored(base: Shelter[], candidate: Shelter[]): Shelter[] {
  const merged = base.map(row => ({ ...row }));
  const added: Shelter[] = [];
  for (const cand of candidate) {
    const key = normName(cand.name);
    const index = merged.findIndex(row => {
      if(cand.correctionTarget)return row.sourceBatchId===cand.correctionTarget.batch_id&&row.id===cand.correctionTarget.report_id;
      const name = normName(row.name);
      const sameName = key && name === key;
      const villageClash = row.village !== UNKNOWN_VILLAGE && cand.village !== UNKNOWN_VILLAGE && normName(row.village) !== normName(cand.village);
      return sameName && !villageClash;
    });
    if (index < 0) { added.push({ ...cand, changes: ['baru'] }); continue; }
    const old = merged[index];
    const next: Shelter = { ...old };
    next.calculationKey=cand.calculationKey;
    if(next.calculationKey!==old.calculationKey){next.requirements=undefined;next.shortages=undefined;next.water=null;next.gap=null;}
    next.correctionTarget=cand.correctionTarget;
    next.candidateLineage=cand.candidateLineage;
    next.sourceBatchId=cand.sourceBatchId;
    const changes: string[] = [];
    if(cand.correctionTarget&&cand.name!==old.name){next.name=cand.name;changes.push(`nama posko ${old.name} → ${cand.name}`);}
    for (const [field, label] of fields) {
      const value = cand[field] as number | null;
      if (cand.correctionTarget || (value !== null && value !== undefined)) {
        if (value !== old[field]) changes.push(`${label} ${old[field] ?? 'kosong'} → ${value}`);
        (next as any)[field] = value;
      }
    }
    const newNeeds = (cand.needs || []).filter(need => !old.needs.some(o => o.toLowerCase() === need.toLowerCase()) && need !== 'Kebutuhan perlu diperiksa');
    if(cand.correctionTarget){
      next.needs=[...cand.needs];
      if(JSON.stringify(old.needs)!==JSON.stringify(cand.needs))changes.push('kebutuhan diperbarui');
    }else if (newNeeds.length) { next.needs = [...old.needs, ...newNeeds]; changes.push(`kebutuhan +${newNeeds.join(', ')}`); }
    if (cand.village !== UNKNOWN_VILLAGE) next.village = cand.village;
    if (cand.time !== UNKNOWN_TIME) next.time = cand.time;
    if (cand.source) next.source = cand.source;
    const issues: string[] = [];
    if (next.people !== null && next.male !== null && next.female !== null && next.male + next.female !== next.people)
      issues.push(`${next.male} laki-laki + ${next.female} perempuan = ${next.male + next.female}, berbeda dari total ${next.people}.`);
    const values:Record<string,unknown>={shelter_name:next.name,village:next.village===UNKNOWN_VILLAGE?null:next.village,total_people:next.people,male:next.male,female:next.female,elderly:next.elderly,disability:next.disability,urgent_needs:next.needs.length?next.needs:null};
    next.reviewItems=(cand.reviewItems||[]).filter(item=>item.kind!=='missing'||!(item.field in values)||values[item.field]==null);
    if(issues.length&&!next.reviewItems.some(item=>item.field==='male+female'))next.reviewItems.push({kind:'clarification',field:'male+female',text:issues[0]});
    next.status = issues.length || cand.status === 'Perlu klarifikasi' ? 'Perlu klarifikasi' : cand.status === 'Menunggu persetujuan' ? cand.status : cand.correctionTarget ? cand.status : next.people === null ? 'Parsial' : 'Siap ditinjau';
    next.changes = changes;
    next.note = [changes.length ? `Perubahan dari rekap tersimpan: ${changes.join(', ')}. Perubahan belum disimpan.` : 'Tidak ada angka yang berubah.', ...issues, ['Perlu klarifikasi','Menunggu persetujuan'].includes(cand.status) ? cand.note : ''].filter(Boolean).join(' ');
    merged[index] = next;
  }
  return [...merged, ...added];
}
