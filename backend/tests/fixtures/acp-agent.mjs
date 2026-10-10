import readline from 'node:readline';
const send = value => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\n');
let count = 0;
const sessions = new Set(), prompts = new Map();
for await (const line of readline.createInterface({ input: process.stdin })) {
  const msg = JSON.parse(line);
  if (msg.method === 'initialize') {
    if (!msg.params.clientCapabilities || msg.params.clientCapabilities.terminal) send({ id: msg.id, error: { code: -32602, message: 'Wrong client capabilities' } });
    else send({ id: msg.id, result: { protocolVersion: 1, agentCapabilities: { sessionCapabilities: { close: {} } } } });
  } else if (msg.method === 'session/new') {
    if (!msg.params.cwd || !Array.isArray(msg.params.mcpServers)) send({ id: msg.id, error: { code: -32602, message: 'cwd and mcpServers required' } });
    else { const sessionId = 'acp-' + (++count); sessions.add(sessionId); send({ id: msg.id, result: { sessionId } }); }
  } else if (msg.method === 'session/prompt') {
    if (!sessions.has(msg.params.sessionId) || !Array.isArray(msg.params.prompt)) send({ id: msg.id, error: { code: -32602, message: 'Bad session or prompt' } });
    else {
      send({ method: 'session/update', params: { sessionId: msg.params.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: msg.params.prompt[0] } } });
      const id = 'permission-' + msg.params.sessionId;
      prompts.set(id, msg);
      send({ id, method: 'session/request_permission', params: { sessionId: msg.params.sessionId, toolCall: { toolCallId: id, name: 'unknown_write', rawInput: {} }, options: [{ kind: 'allow_once', optionId: 'yes' }, { kind: 'reject_once', optionId: 'no' }] } });
    }
  } else if (msg.method === 'session/close') { sessions.delete(msg.params.sessionId); send({ id: msg.id, result: {} }); }
  else if (prompts.has(msg.id)) {
    const prompt = prompts.get(msg.id); prompts.delete(msg.id);
    if (msg.result?.outcome?.outcome !== 'selected' || msg.result.outcome.optionId !== 'no') send({ id: prompt.id, error: { code: -32602, message: 'Permission must reject once using ACP outcome' } });
    else send({ id: prompt.id, result: { stopReason: 'end_turn' } });
  }
}
