import { randomBytes } from "node:crypto";
import type {
    SigapRepository,
    SessionRecord,
    BatchRecord,
    SnapshotRecord,
    ApprovalRecord,
    EventRecord,
} from "./repo.js";
import type { Repository } from "./contract.js";
import { SupabaseGateway } from "../supabase/client.js";
import { mapConcurrent, checkedWorkspaceState, type WorkspaceState, type SubmissionState } from "./workspace.js";
type Param<K extends keyof SigapRepository> = SigapRepository[K] extends (
    ...args: infer A
) => any
    ? A
    : never;
const id = () => randomBytes(16).toString("hex");
const now = () => new Date().toISOString();
export class SupabaseRepository implements Repository {
    constructor(readonly gateway: SupabaseGateway) {}
    private get<T>(kind: string, id: string): Promise<T | null> {
        return this.gateway.call("entity.get", { kind, id });
    }
    private list<T>(kind: string, filter: object): Promise<T[]> {
        return this.gateway.call("entity.list", { kind, filter });
    }
    private put<T>(kind: string, id: string, document: T): Promise<T> {
        return this.gateway.call("entity.put", { kind, id, document });
    }
    private patch<T>(
        kind: string,
        id: string,
        patch: object,
        expected?: object,
    ): Promise<T | null> {
        return this.gateway.call("entity.patch", { kind, id, patch, expected });
    }
    async createSession(contextId = "posko-default"): Promise<SessionRecord> {
        const session_id = id(),
            stamp = now();
        return this.put("sessions", session_id, {
            session_id,
            context_id: contextId,
            created_at: stamp,
            last_active_at: stamp,
            status: "active",
        });
    }
    async bindSession(
        sessionId: string,
        actorId: string,
        organizationId: string,
    ) {
        await this.patch("sessions", sessionId, {
            owner_user_id: actorId,
            organization_id: organizationId,
        });
    }
    getSession(sessionId: string) {
        return this.get<SessionRecord>("sessions", sessionId);
    }
    async resumableSession(
        contextId: string,
        actorId: string,
        organizationId: string,
    ) {
        return (
            (
                await this.list<SessionRecord>("sessions", {
                    context_id: contextId,
                    owner_user_id: actorId,
                    organization_id: organizationId,
                    status: "active",
                })
            ).sort((a, b) =>
                b.last_active_at.localeCompare(a.last_active_at),
            )[0] ?? null
        );
    }
    async touchSession(sessionId: string) {
        await this.patch("sessions", sessionId, { last_active_at: now() });
    }
    async getActiveBatch(sessionId: string) {
        const result=await this.gateway.call<BatchRecord[]|WorkspaceState>("entity.list",{
            kind:"batches",filter:{session_id:sessionId},workspace_state:true,active_only:true,workspace_cutoff:now(),
        });
        if(!Array.isArray(result))return checkedWorkspaceState(result,sessionId,true).activeBatch;
        return (
            result.filter(b=>b.session_id===sessionId)
                .filter((b) =>
                    ["processing", "saving", "verifying"].includes(b.status),
                )
                .at(-1) ?? null
        );
    }
    async getSubmissionState(sessionId:string,requestId:string):Promise<SubmissionState> {
        const encodedRequestId=sessionId+":"+requestId;
        const result=await this.gateway.call<SubmissionState|BatchRecord[]>("entity.list",{
            kind:"batches",filter:{session_id:sessionId},submission_state:true,request_id:encodedRequestId,
        });
        // Pre-upgrade gateways return the legacy list. Derive all checks from that
        // one session-scoped response instead of repeating full-history downloads.
        if(Array.isArray(result)){
            const batches=result.filter(batch=>batch.session_id===sessionId);
            return {existingBatch:batches.find(batch=>batch.request_id===encodedRequestId)??null,
                activeBatchId:batches.filter(batch=>["processing","saving","verifying"].includes(batch.status)).at(-1)?.batch_id??null,
                firstTurn:batches.length===0};
        }
        if(!result||typeof result.firstTurn!=="boolean"||
            !(result.activeBatchId===null||typeof result.activeBatchId==="string"&&result.activeBatchId.length>0)||
            !(result.existingBatch===null||result.existingBatch?.session_id===sessionId&&result.existingBatch.request_id===encodedRequestId&&typeof result.existingBatch.batch_id==="string")||
            result.firstTurn&&(result.existingBatch!==null||result.activeBatchId!==null))throw new Error("Invalid submission state");
        return result;
    }
    async countBatches(sessionId: string) {
        return (await this.list("batches", { session_id: sessionId })).length;
    }
    async getBatchByRequestId(requestId: string, sessionId: string) {
        return (
            (
                await this.list<BatchRecord>("batches", {
                    request_id: sessionId + ":" + requestId,
                    session_id: sessionId,
                })
            )[0] ?? null
        );
    }
    getBatch(batchId: string) {
        return this.get<BatchRecord>("batches", batchId);
    }
    createBatch(params: Param<"createBatch">[0]): Promise<BatchRecord> {
        const stamp = now(),
            batch_id = id();
        return this.put("batches", batch_id, {
            batch_id,
            session_id: params.sessionId,
            request_id: params.sessionId + ":" + params.requestId,
            context_id: params.contextId,
            status: "processing",
            source_sha256: params.sourceSha256,
            source_length: params.sourceLength,
            filtered_text: params.filteredText,
            pii_summary_json: JSON.stringify(params.piiSummary ?? {}),
            latest_snapshot_id: null,
            latest_snapshot_sha256: null,
            quality_status: null,
            preview_payload_json: null,
            gap_payload_json: null,
            bulletin_payload_json: null,
            created_at: stamp,
            updated_at: stamp,
        });
    }
    async updateBatchStatus(
        batchId: string,
        status: string,
        extra?: Partial<BatchRecord>,
    ) {
        const patch: Record<string, unknown> = { status, updated_at: now() };
        for (const k of [
            "latest_snapshot_id",
            "latest_snapshot_sha256",
            "quality_status",
            "preview_payload_json",
            "gap_payload_json",
            "bulletin_payload_json",
        ] as const)
            if (extra?.[k] !== undefined) patch[k] = extra[k];
        await this.patch("batches", batchId, patch);
    }
    async updateBatchPayload(batchId: string, extra: Param<"updateBatchPayload">[1]): Promise<void> {
        const patch: Record<string, unknown> = {updated_at: now()};
        for (const key of ["preview_payload_json", "gap_payload_json", "bulletin_payload_json"] as const)
            if (extra[key] !== undefined) patch[key] = extra[key];
        if (!await this.patch("batches", batchId, patch)) throw new Error("Batch not found");
    }

    appendEvent(params: Param<"appendEvent">[0]): Promise<EventRecord> {
        return this.put("events", id(), {
            event_id: 0,
            session_id: params.sessionId,
            batch_id: params.batchId ?? null,
            request_id: params.requestId ?? null,
            event_type: params.eventType,
            payload_json: JSON.stringify(params.payload ?? {}),
            created_at: now(),
        });
    }
    async getLatestEventId(sessionId: string): Promise<number> {
        const result = await this.gateway.call<number | EventRecord[]>("entity.list", {
            kind: "events", filter: {session_id: sessionId}, latest_event_id: true,
        });
        // Older gateways ignore the option and return the original event list.
        const cursor = Array.isArray(result)
            ? result.filter(e => e.session_id === sessionId).reduce((latest, e) => Math.max(latest, e.event_id), 0)
            : result;
        if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error("Invalid event cursor");
        return cursor;
    }

    async getEventsAfter(sessionId: string, afterEventId = 0) {
        return (
            await this.gateway.call<EventRecord[]>("entity.list", {
                kind: "events", filter: {session_id: sessionId}, after_event_id: afterEventId,
            })
        )
            .filter((e) => e.session_id === sessionId && e.event_id > afterEventId)
            .sort((a, b) => a.event_id - b.event_id);
    }
    async saveSnapshot(
        params: Param<"saveSnapshot">[0],
    ): Promise<SnapshotRecord> {
        const snapshot: SnapshotRecord = {
            snapshot_id: params.snapshotId,
            snapshot_sha256: params.snapshotSha256,
            batch_id: params.batchId,
            version: params.version,
            quality_status: params.qualityStatus,
            payload_json: JSON.stringify(params.payload),
            created_at: now(),
            expires_at: new Date(
                Date.now() + (params.expiresInSeconds || 86400) * 1000,
            ).toISOString(),
            superseded_by: null,
        };
        await this.put("snapshots", params.snapshotId, snapshot);
        await this.updateBatchStatus(params.batchId, "ready_for_review", {
            latest_snapshot_id: params.snapshotId,
            latest_snapshot_sha256: params.snapshotSha256,
            quality_status: params.qualityStatus,
            preview_payload_json: snapshot.payload_json,
        });
        return snapshot;
    }
    async getOrCreateReviewSnapshot(params:Param<"getOrCreateReviewSnapshot">[0]):Promise<{created:boolean;snapshot:SnapshotRecord}> {
        const stamp=now();
        const snapshot:SnapshotRecord={snapshot_id:params.snapshotId,snapshot_sha256:params.snapshotSha256,
            batch_id:params.batchId,version:1,quality_status:params.qualityStatus,payload_json:JSON.stringify(params.payload),
            created_at:stamp,expires_at:new Date(Date.now()+86400000).toISOString(),superseded_by:null};
        const result=await this.gateway.call<{created:boolean;snapshot:SnapshotRecord}>("review.prepare",{session_id:params.sessionId,snapshot});
        if(!result||typeof result.created!=="boolean"||!result.snapshot||result.snapshot.snapshot_id!==params.snapshotId||typeof result.snapshot.payload_json!=="string")
            throw new Error("Invalid review preparation result");
        if(result.created&&(result.snapshot.batch_id!==params.batchId||result.snapshot.snapshot_sha256!==params.snapshotSha256||result.snapshot.payload_json!==snapshot.payload_json||result.snapshot.superseded_by!==null))
            throw new Error("Review preparation changed the validated snapshot");
        return result;
    }
    getSnapshot(snapshotId: string) {
        return this.get<SnapshotRecord>("snapshots", snapshotId);
    }
    async supersedePreviousSnapshots(batchId: string, newSnapshotId: string) {
        for (const s of await this.list<SnapshotRecord>("snapshots", {
            batch_id: batchId,
        }))
            if (s.snapshot_id !== newSnapshotId && !s.superseded_by)
                await this.supersedeSnapshot(s.snapshot_id, newSnapshotId);
    }
    async getWorkspaceState(sessionId: string): Promise<WorkspaceState> {
        const result=await this.gateway.call<BatchRecord[]|WorkspaceState>("entity.list",{
            kind:"batches",filter:{session_id:sessionId},workspace_state:true,workspace_cutoff:now(),
        });
        if(!Array.isArray(result))return checkedWorkspaceState(result,sessionId);
        const batches=result.filter(batch=>batch.session_id===sessionId);
        const cutoff = now();
        const groups = await mapConcurrent(
            batches.filter((b) => b.status === "ready_for_review"),
            6,
            async (batch) => {
                const snapshots = await this.list<SnapshotRecord>("snapshots", {
                    batch_id: batch.batch_id,
                    superseded_by: null,
                });
                return snapshots
                    .filter(
                        (s) =>
                            s.batch_id === batch.batch_id &&
                            !s.superseded_by &&
                            s.expires_at > cutoff,
                    )
                    .map((snapshot) => ({ snapshot, batch }));
            },
        );
        return {
            reviews: groups.flat().reverse(),
            activeBatch:
                batches
                    .filter((b) =>
                        ["processing", "saving", "verifying"].includes(
                            b.status,
                        ),
                    )
                    .at(-1) ?? null,
        };
    }
    async getReviewSnapshots(sessionId: string) {
        return (await this.getWorkspaceState(sessionId)).reviews.map(
            (r) => r.snapshot,
        );
    }
    async supersedeSnapshot(snapshotId: string, newSnapshotId: string) {
        await this.patch(
            "snapshots",
            snapshotId,
            { superseded_by: newSnapshotId },
            { superseded_by: null },
        );
        for (const a of await this.list<ApprovalRecord>("approvals", {
            snapshot_id: snapshotId,
            status: "pending",
        }))
            await this.patch(
                "approvals",
                a.approval_id,
                { status: "revoked" },
                { status: "pending" },
            );
    }
    createApproval(
        params: Param<"createApproval">[0],
    ): Promise<ApprovalRecord> {
        const approval_id = id();
        return this.put("approvals", approval_id, {
            approval_id,
            batch_id: params.batchId,
            actor_id: params.actorId,
            action: params.action,
            snapshot_id: params.snapshotId,
            snapshot_sha256: params.snapshotSha256,
            partial_scope_json: params.partialScope
                ? JSON.stringify(params.partialScope)
                : null,
            clear_decisions_json: params.clearDecisions
                ? JSON.stringify(params.clearDecisions)
                : null,
            status: "pending",
            created_at: now(),
            consumed_at: null,
        });
    }
    async getPendingApprovalForSnapshot(batchId: string, snapshotId: string) {
        return (
            (
                await this.list<ApprovalRecord>("approvals", {
                    batch_id: batchId,
                    snapshot_id: snapshotId,
                    status: "pending",
                })
            ).at(-1) ?? null
        );
    }
    async hasApprovalForSnapshot(batchId: string, snapshotId: string) {
        return (
            await this.list<ApprovalRecord>("approvals", {
                batch_id: batchId,
                snapshot_id: snapshotId,
            })
        ).some((a) => a.status !== "revoked");
    }
    async revokeApprovals(batchId: string) {
        for (const a of await this.list<ApprovalRecord>("approvals", {
            batch_id: batchId,
            status: "pending",
        }))
            await this.patch(
                "approvals",
                a.approval_id,
                { status: "revoked" },
                { status: "pending" },
            );
    }
    async consumeApproval(approvalId: string) {
        return this.gateway.call<boolean>("approval.consume", {
            id: approvalId,
        });
    }
    async logAudit(
        eventType: string,
        actorId: string,
        resourceId?: string,
        details?: any,
    ) {
        await this.put("audit_log", id(), {
            event_type: eventType,
            actor_id: actorId,
            resource_id: resourceId ?? null,
            details_json: details ? JSON.stringify(details) : null,
            organization_id: this.gateway.settings.organizationId,
            created_at: now(),
        });
    }
    async cleanupRetention(_retentionDays = 7) {
        return 0;
    } // Explicit retention job required; no implicit cloud deletion.
    close() {}
}
