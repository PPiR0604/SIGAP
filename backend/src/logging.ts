export function redact(text: string): string {
  if (!text) return '';
  return text
    .replace(/(Bearer\s+)[A-Za-z0-9_\-\.]+/gi, '$1[REDACTED_TOKEN]')
    .replace(/(x-api-key["']?\s*[:=]\s*["']?)[^"',\s]+/gi, '$1[REDACTED_KEY]')
    .replace(/(authorization["']?\s*[:=]\s*["']?)[^"',\s]+/gi, '$1[REDACTED_AUTH]')
    .replace(/\b\d{16}\b/g, '[NIK_REDACTED]')
    .replace(/(?:\+62|62|08)[0-9]{8,12}/g, '[PHONE_REDACTED]');
}

export const logger = {
  info: (msg: string, meta?: any) => {
    const metaStr = meta ? ' ' + redact(JSON.stringify(meta instanceof Error ? { name: meta.name, message: meta.message, stack: meta.stack } : meta)) : '';
    console.log(`[INFO] ${redact(msg)}${metaStr}`);
  },
  warn: (msg: string, meta?: any) => {
    const metaStr = meta ? ' ' + redact(JSON.stringify(meta instanceof Error ? { name: meta.name, message: meta.message, stack: meta.stack } : meta)) : '';
    console.warn(`[WARN] ${redact(msg)}${metaStr}`);
  },
  error: (msg: string, meta?: any) => {
    const metaStr = meta ? ' ' + redact(JSON.stringify(meta instanceof Error ? { name: meta.name, message: meta.message, stack: meta.stack } : meta)) : '';
    console.error(`[ERROR] ${redact(msg)}${metaStr}`);
  }
};
