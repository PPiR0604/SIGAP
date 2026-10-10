import type { ApplicationEvent, ApplicationEventType } from './types.js';
import { canonicalToolName } from './toolNames.js';

export function createEvent(sessionId: string, eventType: ApplicationEventType, payload: any,
  meta?: { batchId?: string; requestId?: string }): ApplicationEvent {
  return { session_id: sessionId, batch_id: meta?.batchId, request_id: meta?.requestId,
    event_type: eventType, payload, timestamp: new Date().toISOString() };
}

function outputText(value: any): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value?.content)) return value.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n');
  return JSON.stringify(value);
}

export function normalizeAcpNotification(method: string, params: any,
  meta: { sessionId: string; batchId?: string; requestId?: string },
  tools = new Map<string, any>()): ApplicationEvent[] {
  if (method !== 'session/update' || !params?.update) return [];
  const update = params.update;
  if (update.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text') {
    return [createEvent(meta.sessionId, 'assistant_message', { chunk: update.content.text, done: false }, meta)];
  }
  if (['tool_call', 'tool_call_update'].includes(update.sessionUpdate)) {
    const old = tools.get(update.toolCallId) || {};
    const current = { ...old, ...Object.fromEntries(Object.entries(update).filter(([, value]) => value != null)) };
    tools.set(update.toolCallId, current);
    if (current.status === 'failed') return [createEvent(meta.sessionId, 'error', { code: 'TOOL_EXECUTION_FAILED', message: 'Tool tidak dapat menyelesaikan proses.' }, meta)];
    if (current.status === 'completed') {
      const types: Record<string, ApplicationEventType> = {
        prepare_needs: 'preview_ready', validate_needs: 'preview_ready', upsert_shelter: 'storage_result',
        fetch_shelters: 'readback_result', calculate_gap: 'calculation_ready', draft_bulletin: 'bulletin_ready'
      };
      const name = canonicalToolName(current.name);
      const type = name ? types[name] : undefined;
      const text = current.rawOutput != null ? outputText(current.rawOutput) :
        (current.content || []).filter((c: any) => c.type === 'content' && c.content?.type === 'text').map((c: any) => c.content.text).join('\n');
      if (name && text.trimStart().startsWith('GAGAL:')) {
        return [createEvent(meta.sessionId,'error',{code:'TOOL_VALIDATION_FAILED',message:text.trim().slice(0,1000)},meta)];
      }
      if (name === 'prepare_needs' && /^\s*<<<SOURCE_REF>>>[\s\S]*?<<<END_SOURCE_REF>>>/m.test(text)) {
        return [createEvent(meta.sessionId, 'stage_changed', { stage: 'source_prepared', toolName: current.name, toolCallId: current.toolCallId }, meta)];
      }
      if (type && text) return [createEvent(meta.sessionId, type, { rawOutput: text, tool_input: current.rawInput }, meta)];
    }
    return [createEvent(meta.sessionId, 'stage_changed', { stage: 'tool:' + (current.name || 'unknown'), toolName: current.name, toolCallId: current.toolCallId }, meta)];
  }
  return [];
}
