// Exact deployed names only. Never strip arbitrary prefixes from an unknown tool.
const aliases: Record<string,string> = {
  sigap_0_fetch_shelters: 'fetch_shelters',
  sigap_1_prepare_needs: 'prepare_needs',
  sigap_2_validate_needs: 'validate_needs',
  sigap_3_calculate_gap: 'calculate_gap',
  sigap_4_flag_anomalies: 'flag_anomalies',
  sigap_5_upsert_shelter: 'upsert_shelter',
  sigap_6_draft_bulletin: 'draft_bulletin'
};
const canonicalNames=new Set(Object.values(aliases));
export function canonicalToolName(name:unknown): string|null {
  if(typeof name!=='string')return null;
  return canonicalNames.has(name)?name:Object.hasOwn(aliases,name)?aliases[name]:null;
}
