import {z} from 'zod';
import type {McpTool} from '../mcp/httpClient.js';

export const analysisToolName='analyze_shelter_needs';
export const AnalysisRequest=z.object({
  view:z.enum(['all_needs','water_ranking','priority_ranking']),
  scope:z.enum(['stored','including_candidates'])
}).strict();

/** Backend composition of the existing authenticated Langflow reader/calculator flows. */
export const analysisTool:McpTool={
  name:analysisToolName,
  description:'Menganalisis rekap semua posko melalui flow Langflow baca/hitung. Input view: all_needs (tabel kebutuhan), water_ranking (urutan kekurangan air), priority_ranking (skor bantuan umum); scope: stored atau including_candidates. Pilih saat pengguna meminta perbandingan/prioritas/ringkasan kebutuhan, dengan bahasa apa pun. BUKAN untuk laporan baru, koreksi, satu lokasi tertentu, simpan, atau distribusi bantuan.',
  inputSchema:{type:'object',properties:{view:{type:'string',enum:['all_needs','water_ranking','priority_ranking']},scope:{type:'string',enum:['stored','including_candidates']}},required:['view','scope'],additionalProperties:false}
};
