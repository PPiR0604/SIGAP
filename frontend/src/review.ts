export type ClearDecision = '' | 'clear' | 'keep' | 'defer';
export const isOcrDocument=(name:string)=>/\.(pdf|png|jpe?g)$/i.test(name);
export function validateReportFile(name: string, size: number) {
  if (!/\.(txt|csv)$/i.test(name)&&!isOcrDocument(name)) throw new Error('Gunakan .txt/.csv, atau PDF, JPG, dan PNG untuk OCR.');
  if (size === 0) throw new Error('File laporan kosong.');
  if(isOcrDocument(name)){if(size>5*1024*1024)throw new Error('Ukuran dokumen OCR maksimal 5 MiB.');return;}
  if (size > 200 * 1024) throw new Error('Ukuran laporan maksimal 200 KiB. Bagi menjadi beberapa batch.');
}
export function approveDemoReview(input: {version:number; reviewedVersion:number; confirmed:boolean; partial:boolean; clearDecision:ClearDecision}) {
  if (input.version !== input.reviewedVersion) throw new Error('Kandidat berubah. Periksa versi terbaru.');
  if (!input.confirmed) throw new Error('Berikan persetujuan eksplisit atas pratinjau ini.');
  if (!input.partial) throw new Error('Konfirmasi bahwa rekap masih parsial dan konflik belum selesai.');
  if (!input.clearDecision) throw new Error('Pilih keputusan pengosongan field.');
  return {mode:'demo' as const, storageVerified:false, version:input.version, clearDecision:input.clearDecision};
}
