import { z } from "zod";
import { isDeepStrictEqual } from "node:util";
import { canonicalToolName } from "../acp/toolNames.js";
import type { Repository } from "../db/contract.js";
import type {
    BatchRecord,
    SnapshotRecord,
    ApprovalRecord,
} from "../db/repo.js";

export const ClearDecisionChoice = z.enum(["clear", "keep", "defer"]);
export type ClearDecisionChoice = z.infer<typeof ClearDecisionChoice>;

export const DecisionRequestBodySchema = z.object({
    action: z.enum(["approve_save", "approve_partial_save", "back_to_review"]),
    snapshot_id: z.string().regex(/^[a-f0-9]{32}$/, "snapshot_id tidak valid"),
    partial_acknowledged: z.boolean().default(false),
    clear_decisions: z
        .record(z.string(), z.record(z.string(), ClearDecisionChoice))
        .default({}),
    conflict_decisions: z
        .record(z.string(), z.record(z.string(), z.enum(["keep", "incoming"])))
        .optional(),
});

export type DecisionRequestBody = z.infer<typeof DecisionRequestBodySchema>;

export interface DecisionValidationResult {
    valid: boolean;
    code?: string;
    message?: string;
    approval?: ApprovalRecord;
}

export async function validateAndCreateApproval(
    repo: Repository,
    batch: BatchRecord,
    actorId: string,
    body: DecisionRequestBody,
): Promise<DecisionValidationResult> {
    batch = (await repo.getBatch(batch.batch_id)) || batch;
    // If action is back_to_review, just record status change
    if (body.action === "back_to_review") {
        if (["saving", "verifying"].includes(batch.status))
            return {
                valid: false,
                code: "WRITE_IN_PROGRESS",
                message: "Penyimpanan sedang berlangsung.",
            };
        await repo.revokeApprovals(batch.batch_id);
        await repo.updateBatchStatus(batch.batch_id, "ready_for_review");
        return { valid: true };
    }

    // 1. Fetch snapshot from DB
    const snapshot = await repo.getSnapshot(body.snapshot_id);
    if (!snapshot) {
        return {
            valid: false,
            code: "SNAPSHOT_NOT_FOUND",
            message:
                "Snapshot kandidat tidak ditemukan. Lakukan validasi ulang.",
        };
    }
    if (
        snapshot.batch_id !== batch.batch_id ||
        batch.latest_snapshot_id !== snapshot.snapshot_id ||
        batch.latest_snapshot_sha256 !== snapshot.snapshot_sha256
    ) {
        return {
            valid: false,
            code: "SNAPSHOT_SUPERSEDED",
            message: "Snapshot bukan kandidat terbaru untuk batch ini.",
        };
    }

    // 2. Check if superseded
    if (snapshot.superseded_by) {
        return {
            valid: false,
            code: "SNAPSHOT_SUPERSEDED",
            message:
                "Kandidat telah diperbarui dengan versi baru. Periksa dan tinjau versi terbaru.",
        };
    }

    // 3. Check expiration (24 hours or config TTL)
    const now = new Date();
    if (now > new Date(snapshot.expires_at)) {
        return {
            valid: false,
            code: "SNAPSHOT_EXPIRED",
            message:
                "Snapshot telah kedaluwarsa (lebih dari 24 jam). Validasi ulang diperlukan.",
        };
    }
    if (
        await repo.hasApprovalForSnapshot(batch.batch_id, snapshot.snapshot_id)
    ) {
        return {
            valid: false,
            code: "ALREADY_APPROVED",
            message:
                "Kandidat ini sudah memiliki keputusan penyimpanan. Jangan ulangi write.",
        };
    }
    if (batch.status !== "ready_for_review")
        return {
            valid: false,
            code: "INVALID_BATCH_STATUS",
            message:
                "Kandidat belum siap atau hasil proses tidak valid. Jalankan validasi ulang.",
        };

    // 4. Parse snapshot payload
    let payload: any = {};
    try {
        payload = JSON.parse(snapshot.payload_json);
    } catch {
        return {
            valid: false,
            code: "SNAPSHOT_CORRUPTED",
            message: "Data snapshot lokal rusak. Lakukan proses ulang.",
        };
    }

    const records: any[] = payload.records || [];
    const conflictMap = Object.fromEntries(
        records.map((r) => [
            r.report_id,
            (r.storage_conflicts || []).map((c: any) => c.field),
        ]),
    );
    for (const [report, fields] of Object.entries(conflictMap))
        for (const field of fields as string[]) {
            if (!body.conflict_decisions?.[report]?.[field])
                return {
                    valid: false,
                    code: "INCOMPLETE_CONFLICT_DECISIONS",
                    message: `Putuskan konflik ${report} (${field}): gunakan nilai tersimpan atau nilai laporan baru.`,
                };
        }
    for (const [report, choices] of Object.entries(
        body.conflict_decisions || {},
    ))
        if (
            Object.keys(choices).some(
                (field) => !conflictMap[report]?.includes(field),
            )
        )
            return {
                valid: false,
                code: "INVALID_CONFLICT_DECISIONS",
                message: "Keputusan konflik harus sesuai field pada pratinjau.",
            };
    const hasIssues =
        !!payload.issues?.length ||
        !!payload.snapshot_issues?.length ||
        records.some(
            (r) =>
                (r.missing_fields && r.missing_fields.length > 0) ||
                (r.validation_issues && r.validation_issues.length > 0) ||
                (r.unverified_numbers && r.unverified_numbers.length > 0) ||
                (r.storage_conflicts && r.storage_conflicts.length > 0) ||
                (r.pending_clear_fields && r.pending_clear_fields.length > 0),
        );

    // 5. Check partial acknowledged if issues exist
    if (hasIssues && !body.partial_acknowledged) {
        return {
            valid: false,
            code: "PARTIAL_CONFIRMATION_REQUIRED",
            message:
                "Rekap ini memuat data parsial atau konflik. Anda wajib menyetujui batas rekap parsial sebelum menyimpan.",
        };
    }

    // 6. Check pending clear fields resolution (every pending clear field must be clear, keep, or defer)
    const pendingMap: Record<string, string[]> = {};
    for (const r of records) {
        if (r.pending_clear_fields && r.pending_clear_fields.length > 0) {
            pendingMap[r.report_id] = r.pending_clear_fields;
        }
    }

    for (const [reportId, fields] of Object.entries(pendingMap)) {
        const decisionsForReport = body.clear_decisions[reportId] || {};
        for (const field of fields) {
            const decision = decisionsForReport[field];
            if (!decision || !["clear", "keep", "defer"].includes(decision)) {
                return {
                    valid: false,
                    code: "INCOMPLETE_CLEAR_DECISIONS",
                    message: `Usulan pengosongan field untuk laporan ${reportId} (${field}) belum diputuskan. Tentukan pilihan: clear, keep, atau defer.`,
                };
            }
        }
    }
    for (const [reportId, choices] of Object.entries(body.clear_decisions)) {
        if (
            Object.keys(choices).some(
                (field) => !pendingMap[reportId]?.includes(field),
            )
        ) {
            return {
                valid: false,
                code: "INVALID_CLEAR_DECISIONS",
                message:
                    "Keputusan hanya boleh mengacu field yang diusulkan pada kandidat.",
            };
        }
    }

    // 7. Create approval record in DB
    const approval = await repo.createApproval({
        batchId: batch.batch_id,
        actorId,
        action: body.action,
        snapshotId: snapshot.snapshot_id,
        snapshotSha256: snapshot.snapshot_sha256,
        partialScope: {
            partial_acknowledged: body.partial_acknowledged,
            conflict_decisions: body.conflict_decisions || {},
        },
        clearDecisions: body.clear_decisions,
    });

    await repo.logAudit("APPROVAL_CREATED", actorId, batch.batch_id, {
        snapshot_id: snapshot.snapshot_id,
        action: body.action,
        clear_decisions: body.clear_decisions,
        conflict_decisions: body.conflict_decisions || {},
    });

    return {
        valid: true,
        approval,
    };
}

export async function verifyToolExecutionAgainstGate(
    repo: Repository,
    batchId: string,
    toolName: string,
    args: any,
    approvalTtlSeconds = 3600,
): Promise<{ allow: boolean; reason?: string }> {
    const canonicalName = canonicalToolName(toolName);
    if (!canonicalName)
        return {
            allow: false,
            reason: "Tool tidak dikenal atau tidak diizinkan.",
        };
    toolName = canonicalName;
    const readTools = [
        "prepare_needs",
        "validate_needs",
        "fetch_shelters",
        "calculate_gap",
        "flag_anomalies",
    ];
    if (readTools.includes(toolName)) return { allow: true };
    if (toolName === "draft_bulletin") {
        // Alasan penolakan diteruskan ke model supaya ia bisa mengulang dengan format yang benar.
        const hint =
            'draft_bulletin hanya boleh dipanggil dengan input_value berupa JSON object yang memuat "action":"preview" tanpa confirmed_create_doc (field lain sesuai skema tool). Ulangi panggilan dengan format itu.';
        try {
            const value = unwrapToolInput(args);
            if (value.confirmed_create_doc === true)
                return {
                    allow: false,
                    reason:
                        "Pembuatan dokumen belum diaktifkan; hanya preview. " +
                        hint,
                };
            return value.action === "preview"
                ? { allow: true }
                : {
                      allow: false,
                      reason: "Nilai action tidak diizinkan. " + hint,
                  };
        } catch {
            return {
                allow: false,
                reason: "Input draft_bulletin bukan JSON object. " + hint,
            };
        }
    }
    if (toolName !== "upsert_shelter")
        return {
            allow: false,
            reason: "Tool tidak dikenal atau tidak diizinkan.",
        };
    try {
        args = unwrapToolInput(args);
    } catch {
        return { allow: false, reason: "Input tool harus JSON terstruktur." };
    }

    // Upsert shelter strictly requires pending approval matching snapshot
    const snapshotId = args?.snapshot_id;
    if (!snapshotId) {
        return {
            allow: false,
            reason: "Tool upsert_shelter tidak menyertakan snapshot_id yang valid.",
        };
    }

    const approval = await repo.getPendingApprovalForSnapshot(
        batchId,
        snapshotId,
    );
    if (!approval) {
        return {
            allow: false,
            reason: "Ditolak: Belum ada persetujuan resmi dari petugas server untuk snapshot ini.",
        };
    }

    if (approval.status !== "pending") {
        return {
            allow: false,
            reason: `Ditolak: Persetujuan untuk snapshot ini berstatus ${approval.status}.`,
        };
    }
    const snapshot = await repo.getSnapshot(snapshotId);
    const batch = await repo.getBatch(batchId);
    if (
        !snapshot ||
        snapshot.batch_id !== batchId ||
        snapshot.superseded_by ||
        snapshot.snapshot_id !== batch?.latest_snapshot_id ||
        snapshot.snapshot_sha256 !== batch.latest_snapshot_sha256 ||
        Date.now() >= Date.parse(snapshot.expires_at) ||
        Date.now() >=
            Date.parse(approval.created_at) + approvalTtlSeconds * 1000
    ) {
        return {
            allow: false,
            reason: "Kandidat atau persetujuan sudah tidak berlaku.",
        };
    }
    if (!isDeepStrictEqual(args, buildApprovedWritePayload(approval))) {
        return {
            allow: false,
            reason: "Parameter write berbeda dari snapshot dan keputusan yang disetujui.",
        };
    }

    // Consume approval atomically
    const consumed = await repo.consumeApproval(approval.approval_id);
    if (!consumed) {
        return {
            allow: false,
            reason: "Ditolak: Persetujuan telah digunakan oleh eksekusi lain (mencegah klik ganda).",
        };
    }

    await repo.logAudit("WRITE_EXECUTED", approval.actor_id, batchId, {
        approval_id: approval.approval_id,
        snapshot_id: snapshotId,
    });

    return { allow: true };
}

export function unwrapToolInput(args: any): any {
    const value = args?.input_value ?? args?.payload ?? args;
    const result = typeof value === "string" ? JSON.parse(value) : value;
    if (!result || typeof result !== "object" || Array.isArray(result))
        throw new Error("Invalid tool input");
    return result;
}

export function buildApprovedWritePayload(
    approval: ApprovalRecord,
): Record<string, any> {
    const decisions = JSON.parse(approval.clear_decisions_json || "{}");
    const clear: Record<string, string[]> = {};
    for (const [reportId, fields] of Object.entries(decisions)) {
        const selected = Object.entries(fields as Record<string, string>)
            .filter(([, choice]) => choice === "clear")
            .map(([field]) => field)
            .sort();
        if (selected.length) clear[reportId] = selected;
    }
    return {
        snapshot_id: approval.snapshot_id,
        snapshot_sha256: approval.snapshot_sha256,
        approved_snapshot_sha256: approval.snapshot_sha256,
        confirmed_by_officer: true,
        allow_partial:
            JSON.parse(approval.partial_scope_json || "{}")
                .partial_acknowledged === true,
        clear_decisions: decisions,
        approved_clear_fields: clear,
        confirmed_clear_fields: Object.keys(clear).length > 0,
        confirmed_clear_decisions: Object.keys(decisions).length > 0,
        ...(Object.keys(
            JSON.parse(approval.partial_scope_json || "{}")
                .conflict_decisions || {},
        ).length
            ? {
                  conflict_decisions: JSON.parse(
                      approval.partial_scope_json || "{}",
                  ).conflict_decisions,
              }
            : {}),
    };
}
