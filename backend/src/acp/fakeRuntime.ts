import type {
    AgentRuntime,
    AgentSessionConfig,
    AgentPromptOptions,
    AgentEventHandler,
    PermissionGate,
} from "./types.js";
import { createEvent } from "./events.js";
import { randomBytes } from "node:crypto";

export interface FakeRuntimeScenario {
    prepareNeedsOutput?: string;
    writeResultOutput?: string;
    readResultOutput?: string;
    gapResultOutput?: string;
    bulletinResultOutput?: string;
    shouldFailStage?:
        | "prepare_needs"
        | "upsert_shelter"
        | "fetch_shelters"
        | "calculate_gap"
        | "draft_bulletin";
    readbackStatus?: "verified" | "mismatch";
}

export class FakeAgentRuntime implements AgentRuntime {
    readonly provider = "mock";
    public scenario: FakeRuntimeScenario = {};
    public toolCallsRecorded: Array<{ name: string; args: any }> = [];

    constructor(initialScenario: FakeRuntimeScenario = {}) {
        this.scenario = initialScenario;
    }

    async isAvailable(): Promise<boolean> {
        return true;
    }

    async initSession(_config: AgentSessionConfig): Promise<string> {
        return "fake-acp-session-1";
    }

    async sendPrompt(
        options: AgentPromptOptions,
        onEvent: AgentEventHandler,
        permissionGate?: PermissionGate,
    ): Promise<void> {
        const meta = { batchId: options.batchId, requestId: options.requestId };
        if (options.operation === "commit") {
            const payload = options.writePayload;
            const permission =
                payload &&
                (await permissionGate?.(options.sessionId, {
                    toolName: "upsert_shelter",
                    args: payload,
                    toolCallId: `mock-${options.batchId}`,
                }));
            if (
                !permission?.allow ||
                this.scenario.shouldFailStage === "upsert_shelter"
            ) {
                onEvent(
                    createEvent(
                        options.sessionId,
                        "error",
                        {
                            code: "WRITE_DENIED",
                            message:
                                permission?.reason || "Simulasi write gagal.",
                        },
                        meta,
                    ),
                );
                return;
            }
            this.toolCallsRecorded.push({
                name: "upsert_shelter",
                args: payload,
            });
            onEvent(
                createEvent(
                    options.sessionId,
                    "storage_result",
                    {
                        rawOutput:
                            this.scenario.writeResultOutput ||
                            JSON.stringify({
                                status: "saved",
                                snapshot_id: payload!.snapshot_id,
                                snapshot_sha256: payload!.snapshot_sha256,
                                storage: { mode: "simulated" },
                            }),
                    },
                    meta,
                ),
            );
            if (this.scenario.shouldFailStage === "fetch_shelters") {
                onEvent(
                    createEvent(
                        options.sessionId,
                        "error",
                        {
                            code: "READBACK_FAILED",
                            message: "Simulasi read-back gagal.",
                        },
                        meta,
                    ),
                );
                return;
            }
            onEvent(
                createEvent(
                    options.sessionId,
                    "readback_result",
                    {
                        tool_input: {
                            expected_snapshot_id: payload!.snapshot_id,
                            expected_snapshot_sha256: payload!.snapshot_sha256,
                        },
                        rawOutput:
                            this.scenario.readResultOutput ||
                            JSON.stringify({
                                status: "ok",
                                verification_status:
                                    this.scenario.readbackStatus || "verified",
                            }),
                    },
                    meta,
                ),
            );
            return;
        }

        // 1. Processing started
        onEvent(
            createEvent(
                options.sessionId,
                "processing_started",
                {
                    batchId: options.batchId,
                    requestId: options.requestId,
                },
                meta,
            ),
        );

        // 2. Stage changed: extraction & validation
        onEvent(
            createEvent(
                options.sessionId,
                "stage_changed",
                {
                    stage: "prepare_needs",
                    toolName: "prepare_needs",
                },
                meta,
            ),
        );

        if (this.scenario.shouldFailStage === "prepare_needs") {
            onEvent(
                createEvent(
                    options.sessionId,
                    "error",
                    {
                        code: "STAGE_FAILED",
                        message: "Simulasi kegagalan tahap prepare_needs.",
                    },
                    meta,
                ),
            );
            return;
        }

        // Default synthetic snapshot data
        let provided: any = {};
        try {
            provided = JSON.parse(this.scenario.prepareNeedsOutput || "{}");
        } catch {
            /* Invalid protocol fixtures remain invalid. */
        }
        const snapshotId =
            provided.snapshot_id || randomBytes(16).toString("hex");
        const snapshotSha256 =
            provided.snapshot_sha256 ||
            "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";

        const defaultPrepareOutput =
            this.scenario.prepareNeedsOutput ||
            JSON.stringify({
                snapshot_id: snapshotId,
                snapshot_sha256: snapshotSha256,
                records: [
                    {
                        report_id: "R001",
                        shelter_name: "Posko Harapan",
                        village: "Cipameungpeuk",
                        total_people: 98,
                        male: 45,
                        female: 55,
                        is_estimate: false,
                        urgent_needs: ["air bersih", "beras"],
                        surplus_do_not_send: [],
                        validation_issues: [
                            {
                                field: "male+female",
                                reason: "Laki-laki 45 + perempuan 55 ≠ total 98.",
                            },
                        ],
                        pending_clear_fields: ["disability"],
                        missing_fields: [],
                    },
                    {
                        report_id: "R002",
                        shelter_name: "Posko Cibening",
                        village: "Cibening",
                        total_people: 91,
                        male: 40,
                        female: 51,
                        is_estimate: false,
                        urgent_needs: ["popok", "minyak goreng"],
                        surplus_do_not_send: [],
                        validation_issues: [],
                        pending_clear_fields: [],
                        missing_fields: [],
                    },
                ],
                snapshot_records: [
                    {
                        report_id: "R001",
                        shelter_name: "Posko Harapan",
                        village: "Cipameungpeuk",
                        total_people: 98,
                        male: 45,
                        female: 55,
                        is_estimate: false,
                        urgent_needs: ["air bersih", "beras"],
                        surplus_do_not_send: [],
                        validation_issues: [
                            {
                                field: "male+female",
                                reason: "Laki-laki 45 + perempuan 55 ≠ total 98.",
                            },
                        ],
                        pending_clear_fields: ["disability"],
                        missing_fields: [],
                    },
                    {
                        report_id: "R002",
                        shelter_name: "Posko Cibening",
                        village: "Cibening",
                        total_people: 91,
                        male: 40,
                        female: 51,
                        is_estimate: false,
                        urgent_needs: ["popok", "minyak goreng"],
                        surplus_do_not_send: [],
                        validation_issues: [],
                        pending_clear_fields: [],
                        missing_fields: [],
                    },
                ],
                issues: [
                    {
                        report_id: "R001",
                        detail: "Konflik jumlah jiwa: 45 + 55 != 98",
                    },
                ],
                snapshot_issues: [
                    {
                        report_id: "R001",
                        field: "male+female",
                        detail: "Posko Harapan: Laki-laki 45 + perempuan 55 ≠ total 98.",
                    },
                ],
                clear_options: {
                    available_clear_actions: {
                        R001: ["disability"],
                    },
                },
            });

        onEvent(
            createEvent(
                options.sessionId,
                "preview_ready",
                {
                    rawOutput: `SIGAP_REFERENCE {"snapshot_id":"${snapshotId}","snapshot_sha256":"${snapshotSha256}"}\n\`\`\`json\n${defaultPrepareOutput}\n\`\`\``,
                },
                meta,
            ),
        );
    }

    async closeSession(_sessionId: string): Promise<void> {}
}
