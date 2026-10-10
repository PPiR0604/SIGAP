export interface AgentSessionConfig {
  sessionId: string;
  contextId: string;
  systemPrompt?: string;
  mcpServerConfig?: any;
}

export interface AgentPromptOptions {
  sessionId: string;
  batchId: string;
  requestId: string;
  prompt: string;
  filteredText?: string;
  operation?: 'prepare' | 'commit';
  /** Pesan pertama pada sesi: backend membaca rekap tersimpan secara paralel tanpa melibatkan model. */
  firstTurn?: boolean;
  writePayload?: Record<string, any>;
}

export type ApplicationEventType =
  | 'processing_started'
  | 'processing_completed'
  | 'stage_changed'
  | 'assistant_message'
  | 'preview_ready'
  | 'approval_required'
  | 'storage_result'
  | 'readback_result'
  | 'stored_rekap_ready'
  | 'calculation_ready'
  | 'bulletin_ready'
  | 'error';

export interface ApplicationEvent {
  event_id?: number;
  session_id: string;
  batch_id?: string;
  request_id?: string;
  event_type: ApplicationEventType;
  payload: any;
  timestamp: string;
}

export type AgentEventHandler = (event: ApplicationEvent) => void;

export interface ToolCallExecution {
  toolName: string;
  args: any;
  toolCallId: string;
}

export interface PermissionDecision {
  allow: boolean;
  reason?: string;
}

export type PermissionGate = (
  sessionId: string,
  toolCall: ToolCallExecution
) => Promise<PermissionDecision>;

export interface AgentRuntime {
  readonly provider?: 'bob' | 'gemini' | 'mock';
  isAvailable(): Promise<boolean>;
  initSession(config: AgentSessionConfig): Promise<string>;
  sendPrompt(
    options: AgentPromptOptions,
    onEvent: AgentEventHandler,
    permissionGate?: PermissionGate
  ): Promise<void>;
  closeSession(sessionId: string): Promise<void>;
  /** Opsional: baca rekap tersimpan langsung lewat tool baca (tanpa model). */
  readStoredRekap?(sessionId: string, signal?: AbortSignal): Promise<{ content: Array<{ type: string; text?: string }>; isError?: boolean } | null>;
  shutdown?(): Promise<void>;
}
