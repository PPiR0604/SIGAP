import { EventEmitter } from 'node:events';
import type { Readable, Writable } from 'node:stream';
import { logger } from '../logging.js';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: any;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

export class AcpJsonRpcClient extends EventEmitter {
  private nextId = 1;
  private pendingRequests = new Map<number | string, {
    resolve: (res: any) => void;
    reject: (err: any) => void;
    timer: NodeJS.Timeout;
  }>();
  private buffer = '';

  constructor(
    private readable: Readable,
    private writable: Writable,
    private defaultTimeoutMs = 60000
  ) {
    super();
    this.setupReader();
  }

  private setupReader() {
    this.readable.setEncoding('utf-8');
    this.readable.on('data', (chunk: string) => {
      this.buffer += chunk;
      const lines = this.buffer.split(/\r?\n/);
      this.buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          this.handleIncoming(msg);
        } catch {
          // Non-JSON line or log output from subprocess, ignore safely
        }
      }
    });

    this.readable.on('error', (err) => {
      logger.error('Stream readable ACP error:', err);
      this.destroy();
    });
    this.readable.on('end', () => this.destroy());
    this.writable.on('error', () => this.destroy());
  }

  private handleIncoming(msg: any) {
    // 1. Is it a response to our request?
    if (!msg || typeof msg !== 'object') return;
    if (!('method' in msg) && ('result' in msg || 'error' in msg) && 'id' in msg && this.pendingRequests.has(msg.id)) {
      const pending = this.pendingRequests.get(msg.id)!;
      this.pendingRequests.delete(msg.id);
      clearTimeout(pending.timer);

      if (msg.error) {
        pending.reject(new Error(`ACP Error [${msg.error.code}]: ${msg.error.message}`));
      } else {
        pending.resolve(msg.result);
      }
      return;
    }

    // 2. Is it a request from the agent to client? (e.g. permission or capability call)
    if ('id' in msg && typeof msg.method === 'string') {
      this.emit('agent_request', {
        id: msg.id,
        method: msg.method,
        params: msg.params
      });
      return;
    }

    // 3. Is it a notification?
    if (typeof msg.method === 'string') {
      this.emit('notification', {
        method: msg.method,
        params: msg.params
      });
    }
  }

  async sendRequest(method: string, params?: any, timeoutMs?: number): Promise<any> {
    const id = this.nextId++;
    const payload: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params
    };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`ACP Request timeout (${timeoutMs || this.defaultTimeoutMs}ms): ${method}`));
        }
      }, timeoutMs || this.defaultTimeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timer });

      try {
        this.writable.write(JSON.stringify(payload) + '\n');
      } catch (err) {
        this.pendingRequests.delete(id);
        clearTimeout(timer);
        reject(err);
      }
    });
  }

  sendResponse(id: number | string, result?: any, error?: any): void {
    const payload: JsonRpcResponse = {
      jsonrpc: '2.0',
      id,
      ...(error ? { error } : { result: result ?? {} })
    };
    try {
      this.writable.write(JSON.stringify(payload) + '\n');
    } catch (err) {
      logger.error('Gagal mengirim respon JSON-RPC ke ACP:', err);
    }
  }

  sendNotification(method: string, params?: any): void {
    this.writable.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }

  destroy(): void {
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Klien ACP dihancurkan.'));
    }
    this.pendingRequests.clear();
  }
}
