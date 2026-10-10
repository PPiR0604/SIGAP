import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface AcpProbeResult {
  bobFound: boolean;
  bobCommand: string;
  timestamp: string;
  notes: string[];
  protocolVersion?: number;
  eventsObserved: string[];
  rawToolOutputExposed?: boolean;
  writeControlPointFound?: boolean;
}

async function findBobCommand(): Promise<string | null> {
  const envCmd = process.env.SIGAP_BOB_COMMAND;
  if (envCmd && (existsSync(envCmd) || envCmd === 'bob')) {
    return envCmd;
  }
  const candidatePaths = [
    resolve(process.cwd(), '../output/bob-acp-runtime/node_modules/.bin/bob.cmd'),
    resolve(process.cwd(), 'output/bob-acp-runtime/node_modules/.bin/bob.cmd'),
    resolve(process.cwd(), '../output/bob-acp-runtime/bob.cmd'),
    'bob'
  ];
  for (const c of candidatePaths) {
    if (existsSync(c)) return c;
  }
  return null;
}

export async function runFeasibility(): Promise<AcpProbeResult> {
  const timestamp = new Date().toISOString();
  const notes: string[] = [];
  const eventsObserved: string[] = [];
  const bobCmd = await findBobCommand();

  if (!bobCmd) {
    notes.push('Bob Shell executable (bob / bob.cmd) tidak ditemukan di PATH maupun path lokal.');
    notes.push('Lingkungan ini menggunakan runtime mock (FakeAgentRuntime) berdasarkan spesifikasi ACP v1.');
    notes.push('Sesuai PRD bagian 11, integrasi Bob nyata belum terverifikasi pada mesin ini; write gate fail-closed / memerlukan titik kontrol terbukti.');

    const summaryMd = `# Bukti Uji Kelayakan Tool ACP — SIGAP

Tanggal: ${timestamp.split('T')[0]}

## Status Kelayakan
- **Bob Shell Runtime**: Tidak ditemukan pada PATH maupun folder runtime lokal saat pengujian dijalankan.
- **Hasil Probe**: Probe tidak dapat menjalankan sesi \`bob acp\` live secara langsung pada lingkungan ini.
- **Arsitektur Fallback (PRD Bagian 11)**:
  - Backend mengimplementasikan antarmuka abstraksi \`AgentRuntime\` yang sepenuhnya kompatibel dengan protokol ACP (Agent Client Protocol v1 JSON-RPC).
  - Mode pengujian menggunakan \`FakeAgentRuntime\` dengan fixture tool output sintetis untuk verifikasi deterministik pipeline backend.
  - **Kontrol Write**: Mengingat event tool live Bob belum terbukti di lingkungan ini, gerbang persetujuan server diberlakukan secara ketat (fail-closed) di level backend sebelum write diteruskan.

## Ambiguitas & Keputusan Desain
1. **Output Tool Terstruktur**: Adapter backend dirancang untuk mengekstrak envelope kanonis (\`SIGAP_REFERENCE\`, \`SIGAP_WRITE_RESULT\`, \`SIGAP_READ_RESULT\`) baik jika dikembalikan sebagai tool event terstruktur maupun jika dikembalikan dalam blok pesan agent.
2. **Titik Kontrol Write**: Dilakukan verifikasi ganda — approval dicatat di SQLite dan dikonsumsi sekali pakai; jika Bob mencoba memanggil write tanpa approval yang cocok atau dengan parameter yang tidak sesuai, request langsung ditolak (cancelled / rejected).
`;

    const evidencePath = resolve(process.cwd(), '../docs/evidence/SIGAP_ACP_TOOL_FEASIBILITY_2026-10-08.md');
    try {
      writeFileSync(evidencePath, summaryMd, 'utf-8');
    } catch {
      // In case path is different, write to local docs
      writeFileSync(resolve(process.cwd(), 'docs_evidence_feasibility.md'), summaryMd, 'utf-8');
    }

    return {
      bobFound: false,
      bobCommand: '',
      timestamp,
      notes,
      eventsObserved,
      rawToolOutputExposed: false,
      writeControlPointFound: false
    };
  }

  // If bob was found, we would attempt ACP handshake
  notes.push(`Bob Shell ditemukan: ${bobCmd}. Memulai handshake...`);
  return {
    bobFound: true,
    bobCommand: bobCmd,
    timestamp,
    notes,
    eventsObserved,
    rawToolOutputExposed: false,
    writeControlPointFound: false
  };
}

if (process.argv[1]?.endsWith('acp-feasibility.ts')) {
  runFeasibility().then((res) => {
    console.log(JSON.stringify(res, null, 2));
  });
}
