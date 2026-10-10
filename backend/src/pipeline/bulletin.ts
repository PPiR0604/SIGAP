/** Buletin dari rekap tersimpan memakai seluruh read-back, bukan kandidat koreksi terakhir. */
export function isStoredBulletinRequest(text:string):boolean {
  if(/\b(?:dari|untuk|berdasarkan)\s+(?:snapshot\s+)?kandidat\b/i.test(text))return false;
  return /^(?:(?:tolong|mohon|coba|bisa|bisakah|boleh|bolehkah|silakan)\s+)*(?:susun|susunkan|buat|buatkan|tampilkan|siapkan)\b/i.test(text.trim())
    && /\b(?:buletin|bulletin)\b/i.test(text)
    && /\b(?:rekap|tersimpan|semua|seluruh)\b/i.test(text);
}
