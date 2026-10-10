import { getSessionToken } from './api.js';

type Handlers = Record<string, (payload: any) => void>;

export function connectEventStream(url: string, token: string | (() => string), handlers: Handlers,
  onError: (error: Error) => void = () => {}): { close(): void } {
  const controller = new AbortController();
  let lastId = '';
  const run = async () => {
    while (!controller.signal.aborted) {
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      try {
        const activeToken = typeof token === 'function' ? token() : (token || getSessionToken());
        const response = await fetch(url, { headers: { ...(activeToken ? { Authorization: `Bearer ${activeToken}` } : {}), Accept: 'text/event-stream', ...(lastId ? { 'Last-Event-ID': lastId } : {}) }, signal: controller.signal });
        if (!response.ok || !response.body) {
          const error = new Error(`Koneksi event gagal (${response.status}).`);
          onError(error);
          if ([401, 403, 404].includes(response.status)) return;
          throw error;
        }
        reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (!controller.signal.aborted) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          let boundary: RegExpExecArray | null;
          while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
            const frame = buffer.slice(0, boundary.index);
            buffer = buffer.slice(boundary.index + boundary[0].length);
            let event = 'message', id = '';
            const data: string[] = [];
            for (const line of frame.split(/\r?\n/)) {
              if (line.startsWith('id:')) id = line.slice(3).trim();
              if (line.startsWith('event:')) event = line.slice(6).trim();
              if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
            }
            if (data.length && (!id || Number(id) > Number(lastId || 0))) {
              handlers[event]?.(JSON.parse(data.join('\n')));
              if (id) lastId = id;
            }
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) onError(error instanceof Error ? error : new Error('Koneksi event terputus.'));
      } finally { await reader?.cancel().catch(() => {}); }
      if (!controller.signal.aborted) await new Promise<void>(resolve => {
        const abort = () => { clearTimeout(timer); resolve(); };
        const timer = setTimeout(() => { controller.signal.removeEventListener('abort', abort); resolve(); }, 500);
        controller.signal.addEventListener('abort', abort, { once: true });
      });
    }
  };
  void run();
  return { close: () => controller.abort() };
}
