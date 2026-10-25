import { z } from 'zod';

const HEX_32_REGEX = /^[a-f0-9]{32}$/;
const HEX_64_REGEX = /^[a-f0-9]{64}$/;

export const SigapReferenceSchema = z.object({
  snapshot_id: z.string().regex(HEX_32_REGEX, 'snapshot_id harus 32 hex karakter'),
  snapshot_sha256: z.string().regex(HEX_64_REGEX, 'snapshot_sha256 harus 64 hex karakter'),
  report_count: z.number().int().nonnegative().optional(),
  shelter_count: z.number().int().nonnegative().optional(),
  status: z.string().optional(),
  snapshot_conflict_count: z.number().int().nonnegative().optional(),
  available_clear_actions: z.record(z.string(), z.array(z.string())).optional()
});

export type SigapReference = z.infer<typeof SigapReferenceSchema>;

export const ShelterRecordSchema = z.object({
  report_id: z.string().optional(),
  shelter_name: z.string().nullable().optional(),
  village: z.string().nullable().optional(),
  total_people: z.number().int().nonnegative().nullable().optional(),
  total_families: z.number().int().nonnegative().nullable().optional(),
  male: z.number().int().nonnegative().nullable().optional(),
  female: z.number().int().nonnegative().nullable().optional(),
  infants_toddlers: z.number().int().nonnegative().nullable().optional(),
  children: z.number().int().nonnegative().nullable().optional(),
  elderly: z.number().int().nonnegative().nullable().optional(),
  pregnant: z.number().int().nonnegative().nullable().optional(),
  breastfeeding: z.number().int().nonnegative().nullable().optional(),
  disability: z.number().int().nonnegative().nullable().optional(),
  is_estimate: z.boolean().nullable().optional(),
  urgent_needs: z.array(z.any()).optional(),
  surplus_do_not_send: z.array(z.any()).optional(),
  validation_issues: z.array(z.any()).optional(),
  pending_clear_fields: z.array(z.string()).optional(),
  missing_fields: z.array(z.string()).optional(),
  field_provenance: z.record(z.string(), z.any()).optional(),
  stock: z.record(z.string(), z.any()).optional(),
  stock_context: z.record(z.string(), z.any()).optional(),
  storage_conflicts:z.array(z.object({field:z.string(),previous_value:z.any(),incoming_value:z.any()}).passthrough()).optional()
}).passthrough();

export type ShelterRecord = z.infer<typeof ShelterRecordSchema>;

export const PrepareNeedsResultSchema = z.object({
  snapshot_id: z.string().regex(HEX_32_REGEX),
  snapshot_sha256: z.string().regex(HEX_64_REGEX),
  records: z.array(ShelterRecordSchema).default([]),
  snapshot_records: z.array(ShelterRecordSchema).default([]),
  issues: z.array(z.any()).default([]),
  snapshot_issues: z.array(z.any()).default([]),
  clear_options: z.object({
    available_clear_actions: z.record(z.string(), z.array(z.string())).optional(),
    pending_changes: z.array(z.any()).optional()
  }).optional()
}).passthrough();

export type PrepareNeedsResult = z.infer<typeof PrepareNeedsResultSchema>;

export const SigapWriteResultSchema = z.object({
  snapshot_id: z.string().regex(HEX_32_REGEX).optional(),
  snapshot_sha256: z.string().regex(HEX_64_REGEX).optional(),
  status: z.string().optional(),
  revision_error: z.string().optional(),
  applied_actions: z.record(z.string(), z.any()).optional(),
  applied_clear_fields: z.record(z.string(), z.any()).optional(),
  storage: z.object({
    mode: z.string().optional(),
    path: z.string().optional(),
    url: z.string().optional()
  }).optional()
}).passthrough();

export type SigapWriteResult = z.infer<typeof SigapWriteResultSchema>;

export const SigapReadResultSchema = z.object({
  status: z.string(),
  source: z.string().optional(),
  total_shelters: z.number().int().nonnegative().optional(),
  matched_shelters: z.number().int().nonnegative().optional(),
  snapshot_id: z.string().regex(HEX_32_REGEX).optional(),
  snapshot_sha256: z.string().regex(HEX_64_REGEX).optional(),
  verification_status: z.enum(['verified', 'mismatch', 'not_requested']).optional(),
  records: z.array(z.any()).optional(),
  verification: z.object({
    status: z.enum(['verified', 'mismatch', 'not_requested']),
    matched_count: z.number().optional(),
    expected_count: z.number().optional(),
    difference_count: z.number().optional(),
    differences: z.array(z.any()).optional(),
    reason: z.string().optional()
  }).optional()
}).passthrough();

export type SigapReadResult = z.infer<typeof SigapReadResultSchema>;

export const GapResultSchema = z.object({
  shelters: z.array(z.object({
    shelter_name: z.string(),
    village: z.string().nullable().optional(),
    total_people: z.number().int().nonnegative().nullable().optional(),
    is_estimate: z.boolean().nullable().optional(),
    priority: z.string(),
    reasons: z.array(z.string()).default([]),
    issues: z.array(z.string()).default([]),
    gaps: z.record(z.string(), z.any()).default({}),
    needs: z.record(z.string(), z.any()).default({})
  }).passthrough()),
  totals: z.object({
    total_people: z.number().int().nonnegative().nullable().optional(),
    air_liter_per_hari: z.number().nullable().optional(),
    kkal_per_hari: z.number().nullable().optional()
  }).passthrough(),
  partial: z.boolean().optional(),
  snapshot_id: z.string().regex(HEX_32_REGEX).optional(),
  snapshot_sha256: z.string().regex(HEX_64_REGEX).optional()
}).passthrough();

export type GapResult = z.infer<typeof GapResultSchema>;

export const BulletinResultSchema = z.object({
  action: z.string().optional(),
  content: z.string(),
  content_sha256: z.string().regex(HEX_64_REGEX),
  preview_at: z.string(),
  disaster_name: z.string().optional(),
  contact: z.string().optional(),
  confirmed_create_doc: z.boolean().optional(),
  approved_content_sha256: z.string().nullable().optional(),
  snapshot_id: z.string().regex(HEX_32_REGEX).optional(),
  snapshot_sha256: z.string().regex(HEX_64_REGEX).optional()
}).passthrough();

export type BulletinResult = z.infer<typeof BulletinResultSchema>;

export function extractFencedJson(text: string): any | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/g;
  let match;
  let lastJson: any = null;
  while ((match = fenced.exec(text)) !== null) {
    try {
      lastJson = JSON.parse(match[1].trim());
    } catch {
      // ignore non-json fenced blocks
    }
  }
  if (lastJson) return lastJson;

  // Try direct JSON object or array
  const trimmed = text.trim();
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  }
  return null;
}

export function parseSigapReference(text: string): SigapReference | null {
  const lineMatch = /SIGAP_REFERENCE\s+({[\s\S]*?})(?:\r?\n|$)/.exec(text);
  if (!lineMatch) return null;
  try {
    const raw = JSON.parse(lineMatch[1]);
    return SigapReferenceSchema.parse(raw);
  } catch {
    return null;
  }
}

export function parsePrepareNeedsOutput(text: string): PrepareNeedsResult {
  const sigapRef = parseSigapReference(text);
  const fenced = extractFencedJson(text);

  if (!fenced && !sigapRef) {
    throw new Error('Gagal mengekstrak output terstruktur dari prepare_needs.');
  }

  const combined = {
    ...(fenced || {}),
    snapshot_id: sigapRef?.snapshot_id || fenced?.snapshot_id,
    snapshot_sha256: sigapRef?.snapshot_sha256 || fenced?.snapshot_sha256
  };

  return PrepareNeedsResultSchema.parse(combined);
}

export function parseSigapWriteResult(text: string): SigapWriteResult {
  const lineMatch = /SIGAP_WRITE_RESULT\s+({[\s\S]*?})(?:\r?\n|$)/.exec(text);
  let parsedJson = null;
  if (lineMatch) {
    try {
      parsedJson = JSON.parse(lineMatch[1]);
    } catch {
      // fallback
    }
  }
  if (!parsedJson) {
    parsedJson = extractFencedJson(text);
  }
  if (!parsedJson) {
    throw new Error('Gagal mengekstrak SIGAP_WRITE_RESULT dari output tool upsert_shelter.');
  }
  return SigapWriteResultSchema.parse(parsedJson);
}

export function parseSigapReadResult(text: string): SigapReadResult {
  const lineMatch = /SIGAP_READ_RESULT\s+({[\s\S]*?})(?:\r?\n|$)/.exec(text);
  const fenced = extractFencedJson(text);
  let lineData = null;
  if (lineMatch) {
    try {
      lineData = JSON.parse(lineMatch[1]);
    } catch {
      // ignore
    }
  }

  const combined = {
    ...(lineData || {}),
    ...(fenced || {})
  };

  if (!combined.status) {
    throw new Error('Gagal mengekstrak SIGAP_READ_RESULT dari output fetch_shelters.');
  }
  return SigapReadResultSchema.parse(combined);
}

export function parseGapResult(text: string): GapResult {
  const fenced = extractFencedJson(text);
  if (!fenced || !Array.isArray(fenced.shelters) || !fenced.totals) {
    throw new Error('Gagal mengekstrak payload kalkulasi gap dari calculate_gap.');
  }
  return GapResultSchema.parse(fenced);
}

export function parseBulletinResult(text: string): BulletinResult {
  let payload = extractFencedJson(text);
  if (!payload) {
    // The Langflow webhook refuses unapproved publication, but returns the
    // complete JSON preview after this label for the UI to display. MCP may
    // include both formatted and raw copies; use the last preview.
    const preview = [...text.matchAll(/(?:^|\r?\n)Pratinjau \(belum disimpan\):\s*/g)].at(-1);
    if (preview) {
      try {
        payload = JSON.parse(text.slice(preview.index! + preview[0].length));
      } catch {
        // Invalid tool output must still fail validation.
      }
    }
  }
  if (!payload || typeof payload.content !== 'string' || typeof payload.content_sha256 !== 'string') {
    throw new Error('Gagal mengekstrak draf buletin dari draft_bulletin.');
  }
  return BulletinResultSchema.parse(payload);
}
