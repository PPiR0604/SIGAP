const legacyFooter = 'Disusun dari laporan posko; persetujuan rekap tidak membuktikan kondisi lapangan terkini. Tidak memuat data pribadi pengungsi.';

/** Clean only a final attribution; keep the canonical server payload/hash intact. */
export function bulletinForReading(text: string): string {
  const lines = text.trimEnd().split(/\r?\n/);
  const last = (lines.at(-1) || '').trim().replace(/^[*_]+|[*_]+$/g, '').trim();
  const attribution = /^(?:buletin|draf(?: buletin)?|dokumen)(?: ini)?\s+(?:dibuat|disusun|dihasilkan)\b.*\b(?:oleh|otomatis)\b/i;
  if (last !== legacyFooter && !attribution.test(last)) return text;
  lines.pop();
  return lines.join('\n').trimEnd();
}
