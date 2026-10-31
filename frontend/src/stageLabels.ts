const labels: Record<string, string> = {
  fetch_shelters: 'Membaca rekap tersimpan',
  prepare_needs: 'Mengekstrak data dari laporan',
  source_prepared: 'Mengekstrak data dari laporan',
  extract_report: 'Mengekstrak data dari laporan',
  validate_needs: 'Memeriksa dan memvalidasi data',
  calculate_gap: 'Menghitung kebutuhan posko',
  calculate_gap_all: 'Memeriksa kebutuhan seluruh desa',
  recalculate_correction: 'Menghitung ulang kebutuhan setelah koreksi',
  calculate_saved: 'Menghitung kebutuhan dari rekap yang sudah disimpan',
  flag_anomalies: 'Memeriksa kejanggalan data',
  upsert_shelter: 'Menyimpan rekap',
  draft_bulletin: 'Menyusun draf buletin',
  storage_read: 'Rekap tersimpan terbaca',
  waiting_quota: 'Menunggu kuota token per menit'
};
const aliases: Record<string, string> = {
  sigap_0_fetch_shelters: 'fetch_shelters', sigap_1_prepare_needs: 'prepare_needs', sigap_2_validate_needs: 'validate_needs',
  sigap_3_calculate_gap: 'calculate_gap', sigap_4_flag_anomalies: 'flag_anomalies', sigap_5_upsert_shelter: 'upsert_shelter',
  sigap_6_draft_bulletin: 'draft_bulletin'
};
function canonical(stage?: string): string {
  const name = String(stage || '').replace(/^tool:/, '');
  return aliases[name] || name;
}
/** Label ramah untuk nama tahap dari server. Kosong bila tahap tidak dikenal. */
export function stageLabel(stage?: string): string { return labels[canonical(stage)] || ''; }
/** Tahap yang menandakan alur laporan (bukan sekadar chat atau pembacaan). */
export function isReportStage(stage?: string): boolean {
  return ['prepare_needs', 'source_prepared', 'extract_report', 'validate_needs', 'upsert_shelter'].includes(canonical(stage));
}
export function isReadOnlyStage(stage?:string):boolean{
  return ['fetch_shelters','storage_read','calculate_gap','calculate_gap_all','flag_anomalies','draft_bulletin','calculate_saved'].includes(canonical(stage));
}
