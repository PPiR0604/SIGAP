/**
 * Penjaga kuota token input per menit (jendela geser 60 detik). Mencatat token prompt yang sudah
 * terpakai dan menunda request berikutnya bila perkiraannya akan melewati batas, supaya Gemini
 * tidak menolak dengan 429. Batas 0 menonaktifkan penjaga.
 */
export class TokenRateLimiter {
  private entries: Array<{at: number; tokens: number}> = [];
  constructor(private limit: number, private windowMs = 60000, private maxWaitMs = 50000, private now: () => number = Date.now) {}

  private prune(): void {
    const cutoff = this.now() - this.windowMs;
    this.entries = this.entries.filter(entry => entry.at > cutoff);
  }
  used(): number { this.prune(); return this.entries.reduce((sum, entry) => sum + entry.tokens, 0); }
  record(tokens: number): void { if (this.limit > 0 && tokens > 0) this.entries.push({at: this.now(), tokens}); }

  /** Menunggu sampai `estimate` token muat dalam jendela. Melempar bila menunggu melewati batas waktu. */
  async acquire(estimate: number, signal?: AbortSignal, onWait?: (waitMs: number) => void): Promise<void> {
    if (this.limit <= 0) return;
    const started = this.now();
    let announced = false;
    for (;;) {
      signal?.throwIfAborted();
      const used = this.used();
      // Request yang sendirian sudah melewati batas tidak akan pernah muat; biarkan lewat saat jendela kosong.
      if (used === 0 || used + estimate <= this.limit) return;
      const wait = Math.max(50, this.entries[0].at + this.windowMs - this.now() + 25);
      if (this.now() - started + wait > this.maxWaitMs) throw new Error('Batas token per menit Gemini tercapai. Coba lagi sebentar.');
      if (!announced) { announced = true; onWait?.(wait); }
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, wait);
        const abort = () => { clearTimeout(timer); reject(new Error('Operasi Gemini dibatalkan atau timeout.')); };
        signal?.addEventListener('abort', abort, {once: true});
      });
    }
  }
}
