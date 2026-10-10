export type ClearDecision = '' | 'clear' | 'keep' | 'defer';
export function validateReportFile(name: string, size: number) {
  if (!name.toLowerCase().endsWith('.txt')) throw new Error('Gunakan file laporan .txt.');
  if (size > 200 * 1024) throw new Error('Ukuran laporan maksimal 200 KiB. Bagi menjadi beberapa batch.');
  if (size === 0) throw new Error('File laporan kosong.');
}
export function approveDemoReview(input: {version:number; reviewedVersion:number; confirmed:boolean; partial:boolean; clearDecision:ClearDecision}) {
  if (input.version !== input.reviewedVersion) throw new Error('Kandidat berubah. Periksa versi terbaru.');
  if (!input.confirmed) throw new Error('Berikan persetujuan eksplisit atas pratinjau ini.');
  if (!input.partial) throw new Error('Konfirmasi bahwa rekap masih parsial dan konflik belum selesai.');
  if (!input.clearDecision) throw new Error('Pilih keputusan pengosongan field.');
  return {mode:'demo' as const, storageVerified:false, version:input.version, clearDecision:input.clearDecision};
}
