/** Safe provider failure: no raw response, prompt, URL or credentials. */
export class GeminiUnavailableError extends Error {
  constructor(){
    super('Layanan Gemini sementara tidak tersedia (503). Coba lagi sebentar.');
    this.name='GeminiUnavailableError';
  }
}
