export interface InputValidationResult {
  valid: boolean;
  byteLength: number;
  error?: {
    code: string;
    message: string;
  };
}

export function validateReportInput(
  text: string,
  filename?: string,
  maxBytes = 204800
): InputValidationResult {
  if (!text || !text.trim()) {
    return {
      valid: false,
      byteLength: 0,
      error: {
        code: 'EMPTY_INPUT',
        message: 'Teks laporan tidak boleh kosong. Masukkan isi laporan atau unggah file .txt.'
      }
    };
  }

  if (filename) {
    const lowerName = filename.toLowerCase();
    if (!lowerName.endsWith('.txt')) {
      return {
        valid: false,
        byteLength: 0,
        error: {
          code: 'INVALID_FILE_TYPE',
          message: 'Format file tidak didukung. Harap unggah file teks dengan ekstensi .txt.'
        }
      };
    }
  }

  // Calculate UTF-8 byte length accurately
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  const byteLength = bytes.byteLength;

  if (byteLength > maxBytes) {
    const maxKiB = Math.round(maxBytes / 1024);
    const currentKiB = Math.round(byteLength / 1024);
    return {
      valid: false,
      byteLength,
      error: {
        code: 'EXCEEDS_MAX_SIZE',
        message: `Ukuran teks (${currentKiB} KiB) melebihi batas awal ${maxKiB} KiB. Silakan bagi laporan menjadi beberapa batch secara manual.`
      }
    };
  }

  return {
    valid: true,
    byteLength
  };
}
