import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve, delimiter, extname } from 'node:path';
import { AcpJsonRpcClient } from './client.js';
import type { AgentRuntime, AgentSessionConfig, AgentPromptOptions, AgentEventHandler, PermissionGate } from './types.js';
import { normalizeAcpNotification, createEvent } from './events.js';

export function findExecutable(command: string): string | null {
  if (existsSync(command)) return resolve(command);
  for (const dir of (process.env.PATH || '').split(delimiter)) {
    for (const suffix of process.platform === 'win32' ? ['', ...(process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';')] : ['']) {
      const path = resolve(dir.replace(/^"|"$/g, ''), command + suffix);
      if (existsSync(path)) return path;
    }
  }
  return null;
}

export class AcpProcessRuntime implements AgentRuntime {
  readonly provider = 'bob';
  private process: ChildProcess | null = null;
  private client: AcpJsonRpcClient | null = null;
  private initializing: Promise<AcpJsonRpcClient> | null = null;
  private capabilities: any = {};
  private sessions = new Map<string, string>();
  private busy = new Set<string>();
  private systemPrompts = new Map<string, string>();
  private workspacePath: string;

  constructor(private bobCommand = 'bob', private bobArgs = '', workspace = 'output/bob-workspace') {
    this.workspacePath = resolve(workspace);
  }
  async isAvailable(): Promise<boolean> { return !!findExecutable(this.bobCommand); }

  private async ensureProcess(): Promise<AcpJsonRpcClient> {
    if (this.initializing) return this.initializing;
    if (this.client && this.process && this.process.exitCode === null && !this.process.killed) return this.client;
    this.initializing = this.start();
    try { return await this.initializing; } finally { this.initializing = null; }
  }
  private async start(): Promise<AcpJsonRpcClient> {
    const command = findExecutable(this.bobCommand);
    if (!command) throw new Error('Bob executable tidak ditemukan.');
    // A Windows cmd shim needs shell execution. Require the executable itself instead.
    if (process.platform === 'win32' && ['.cmd', '.bat'].includes(extname(command).toLowerCase())) throw new Error('Gunakan path bob.exe atau node.exe dengan SIGAP_BOB_ARGS berupa array JSON ke entrypoint Bob; shim .cmd tidak dijalankan.');
    mkdirSync(this.workspacePath, { recursive: true });
    const args = this.bobArgs.trim().startsWith('[') ? JSON.parse(this.bobArgs) : ['acp', ...this.bobArgs.split(/\s+/).filter(Boolean)];
    if (!Array.isArray(args) || args.some(a => typeof a !== 'string') || args.includes('--trust')) throw new Error('Argumen Bob harus array string dan tidak boleh memakai --trust.');
    const child = spawn(command, args, { cwd: this.workspacePath, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.process = child;
    const client = new AcpJsonRpcClient(child.stdout!, child.stdin!);
    this.client = client;
    child.stderr?.resume();
    const clear = () => { client.destroy(); if (this.process === child) { this.client = null; this.process = null; this.sessions.clear(); } };
    child.on('error', clear);
    child.on('exit', clear);
    client.on('agent_request', (request: any) => {
      const localSession = [...this.sessions.entries()].find(([, acpId]) => acpId === request.params?.sessionId)?.[0];
      if (!localSession || !this.busy.has(localSession)) {
        if (request.method === 'session/request_permission') client.sendResponse(request.id, { outcome: { outcome: 'cancelled' } });
        else client.sendResponse(request.id, undefined, { code: -32601, message: 'Kapabilitas tidak didukung.' });
      }
    });
    try {
      const result = await client.sendRequest('initialize', {
        protocolVersion: 1, clientInfo: { name: 'sigap-backend', version: '0.1.0' },
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false }
      });
      if (result?.protocolVersion !== 1) throw new Error('Versi ACP tidak kompatibel.');
      this.capabilities = result.agentCapabilities || {};
      return client;
    } catch (error) { child.kill(); clear(); throw error; }
  }
  async initSession(config: AgentSessionConfig): Promise<string> {
    const existing = this.sessions.get(config.sessionId);
    if (existing) return existing;
    const client = await this.ensureProcess();
    const servers = config.mcpServerConfig || [];
    if (!Array.isArray(servers)) throw new Error('mcpServers harus array ACP.');
    for (const server of servers) {
      if (server.type === 'http' && !this.capabilities.mcpCapabilities?.http) throw new Error('Bob tidak mendukung MCP HTTP.');
      if (server.type === 'sse' && !this.capabilities.mcpCapabilities?.sse) throw new Error('Bob tidak mendukung MCP SSE.');
    }
    const result = await client.sendRequest('session/new', { cwd: this.workspacePath, mcpServers: servers });
    if (typeof result?.sessionId !== 'string' || !result.sessionId) throw new Error('Bob tidak mengembalikan sessionId.');
    this.sessions.set(config.sessionId, result.sessionId);
    if (config.systemPrompt) this.systemPrompts.set(config.sessionId, config.systemPrompt);
    return result.sessionId;
  }
  async sendPrompt(options: AgentPromptOptions, onEvent: AgentEventHandler, permissionGate?: PermissionGate): Promise<void> {
    if (this.busy.has(options.sessionId)) throw new Error('Sesi Bob sedang menjalankan prompt lain.');
    this.busy.add(options.sessionId);
    let client: AcpJsonRpcClient;
    try { client = await this.ensureProcess(); }
    catch (error) { this.busy.delete(options.sessionId); throw error; }
    const acpId = this.sessions.get(options.sessionId);
    if (!acpId) { this.busy.delete(options.sessionId); throw new Error('Inisialisasi sesi ACP diperlukan sebelum prompt.'); }
    const tools = new Map<string, any>();
    const meta = { sessionId: options.sessionId, batchId: options.batchId, requestId: options.requestId };
    const notifications = (data: any) => {
      if (data.params?.sessionId !== acpId) return;
      for (const event of normalizeAcpNotification(data.method, data.params, meta, tools)) onEvent(event);
    };
    const requests = async (request: any) => {
      if (request.params?.sessionId !== acpId) return;
      if (request.method !== 'session/request_permission') {
        client.sendResponse(request.id, undefined, { code: -32601, message: 'Kapabilitas tidak didukung.' }); return;
      }
      const call = { ...(tools.get(request.params.toolCall?.toolCallId) || {}), ...request.params.toolCall };
      const allowOption = request.params.options?.find((o: any) => o.kind === 'allow_once');
      const rejectOption = request.params.options?.find((o: any) => o.kind === 'reject_once');
      let allow = false;
      try {
        if (allowOption && typeof call.name === 'string' && call.rawInput != null && permissionGate) {
          allow = (await permissionGate(options.sessionId, { toolName: call.name, args: call.rawInput, toolCallId: call.toolCallId })).allow;
        }
      } catch { allow = false; }
      const selected = allow ? allowOption : rejectOption;
      client.sendResponse(request.id, { outcome: selected ? { outcome: 'selected', optionId: selected.optionId } : { outcome: 'cancelled' } });
    };
    client.on('notification', notifications);
    client.on('agent_request', requests);
    try {
      onEvent(createEvent(options.sessionId, 'processing_started', {}, meta));
      const instructions = this.systemPrompts.get(options.sessionId);
      await client.sendRequest('session/prompt', { sessionId: acpId, prompt: [{ type: 'text', text: instructions ? instructions + '\n\n' + options.prompt : options.prompt }] });
    } catch (error) {
      client.sendNotification('session/cancel', { sessionId: acpId });
      throw error;
    } finally {
      client.off('notification', notifications);
      client.off('agent_request', requests);
      this.busy.delete(options.sessionId);
    }
  }
  async closeSession(id: string): Promise<void> {
    const acpId = this.sessions.get(id);
    if (acpId && this.client && this.capabilities.sessionCapabilities?.close) {
      try { await this.client.sendRequest('session/close', { sessionId: acpId }, 3000); } catch {}
    }
    this.sessions.delete(id);
    this.systemPrompts.delete(id);
  }
  async shutdown(): Promise<void> {
    this.client?.destroy();
    this.process?.kill();
    this.sessions.clear();
  }
}
