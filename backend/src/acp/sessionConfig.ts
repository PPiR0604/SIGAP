import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findExecutable } from './process.js';
import type { AgentSessionConfig } from './types.js';

function loadSystemPrompt(provider: 'bob' | 'gemini' | 'openai'): string {
  const candidates = [
    // Local dev: ../../../mcp (c:/.../backend/src/acp -> c:/.../mcp)
    fileURLToPath(new URL(`../../../mcp/${provider}_agent_instructions.md`, import.meta.url)),
    // Container or nested backend/mcp: ../../mcp (/app/src/acp -> /app/mcp)
    fileURLToPath(new URL(`../../mcp/${provider}_agent_instructions.md`, import.meta.url)),
    // Working directory relative paths
    resolve(process.cwd(), `mcp/${provider}_agent_instructions.md`),
    resolve(process.cwd(), `../mcp/${provider}_agent_instructions.md`),
    // Fixed container path
    `/app/mcp/${provider}_agent_instructions.md`
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return readFileSync(candidate, 'utf8');
    }
  }
  throw new Error(`Instruksi agen '${provider}_agent_instructions.md' tidak ditemukan.`);
}

export function loadAgentSessionConfig(provider: 'bob' | 'gemini' | 'openai' = 'bob'): Partial<AgentSessionConfig> {
  const systemPrompt = loadSystemPrompt(provider);
  let rawServers: Record<string, any> = {};

  if (process.env.LANGFLOW_MCP_URL?.trim()) {
    rawServers = {
      langflow: {
        type: 'streamable-http',
        url: process.env.LANGFLOW_MCP_URL.trim(),
        headers: process.env.LANGFLOW_API_KEY?.trim() ? { 'x-api-key': process.env.LANGFLOW_API_KEY.trim() } : {},
        disabled: false
      }
    };
  } else {
    const localPath = fileURLToPath(new URL('../../data/langflow-mcp.local.json', import.meta.url));
    const path = process.env.SIGAP_MCP_CONFIG_PATH || (provider !== 'bob' && existsSync(localPath) ? localPath : undefined);
    if (!path) return { systemPrompt, mcpServerConfig: [] };
    const data = JSON.parse(readFileSync(resolve(path), 'utf8'));
    if (/GANTI_DENGAN_/.test(JSON.stringify(data))) throw new Error('Konfigurasi MCP masih berisi placeholder.');
    rawServers = data.mcpServers || {};
  }

  const servers = Object.entries(rawServers).filter(([, value]: [string, any]) => value?.disabled !== true).map(([name, value]: [string, any]) => {
    if (['http', 'streamable-http', 'sse'].includes(value.type)) {
      let serverUrl = value.url;
      try {
        const parsed = new URL(serverUrl);
        if (
          (process.env.SIGAP_DOCKER === '1' || existsSync('/.dockerenv')) &&
          (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
        ) {
          parsed.hostname = 'host.docker.internal';
          serverUrl = parsed.toString();
        }
      } catch {}
      const url = new URL(serverUrl);
      if(!['http:', 'https:'].includes(url.protocol))throw new Error('URL MCP HTTP tidak valid.');
      if(provider !== 'bob' && !['localhost','127.0.0.1','[::1]','host.docker.internal'].includes(url.hostname))throw new Error('MCP LLM saat ini hanya mendukung loopback.');
      if(Object.values(value.headers || {}).some(header=>typeof header!=='string'))throw new Error('Header MCP harus string.');
      return { type: value.type === 'sse' ? 'sse' : 'http', name, url: serverUrl, headers: Object.entries(value.headers || {}).map(([name, value]) => ({ name, value })) };
    }
    if(value.type && value.type!=='stdio')throw new Error('Transport MCP tidak didukung.');
    const command = typeof value.command === 'string' && findExecutable(value.command);
    if (!command || !Array.isArray(value.args) || value.args.some((arg: any) => typeof arg !== 'string')) throw new Error('Konfigurasi executable MCP tidak valid.');
    return { name, command, args: value.args, env: Object.entries(value.env || {}).map(([name, value]) => ({ name, value })) };
  });
  if (!servers.length) throw new Error('Konfigurasi MCP harus memuat server SIGAP.');
  return { systemPrompt, mcpServerConfig: servers };
}
