import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import type { SigapRepository } from '../db/repo.js';
import type { BatchOrchestrator } from '../pipeline/orchestrator.js';
import { validateReportInput } from '../pipeline/inputValidation.js';
import { filterPii } from '../pipeline/pii.js';
import type { AppConfig } from '../config.js';

const MessageBodySchema = z.object({
  request_id: z.string().min(1, 'request_id wajib diisi.'),
  text: z.string(),
  filename: z.string().optional()
});

export function createMessagesRoute(
  repo: SigapRepository,
  orchestrator: BatchOrchestrator,
  config: AppConfig
): FastifyPluginAsync {
  return async (fastify) => {
    fastify.post('/api/sessions/:id/messages', async (request, reply) => {
      const { id: sessionId } = request.params as { id: string };

      // 1. Session exists?
      const session = repo.getSession(sessionId);
      if (!session) {
        return reply.code(404).send({
          error: {
            code: 'SESSION_NOT_FOUND',
            message: `Sesi ${sessionId} tidak ditemukan.`
          }
        });
      }

      // 2. Validate request body schema
      const parseResult = MessageBodySchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.code(422).send({
          error: {
            code: 'INVALID_REQUEST_BODY',
            message: parseResult.error.errors[0]?.message || 'Body permintaan tidak valid.'
          }
        });
      }
      const { request_id: requestId, text, filename } = parseResult.data;

      // 3. Idempotency check: same request_id?
      const existingBatch = repo.getBatchByRequestId(requestId, sessionId);
      if (existingBatch) {
        return reply.code(200).send({
          batch_id: existingBatch.batch_id,
          status: existingBatch.status,
          filtered_text: existingBatch.filtered_text,
          pii_summary: existingBatch.pii_summary_json ? JSON.parse(existingBatch.pii_summary_json) : null
        });
      }

      // 4. Concurrency check: is there another active batch on this session?
      const activeBatch = repo.getActiveBatch(sessionId);
      if (activeBatch || orchestrator.isProcessing(sessionId)) {
        return reply.code(409).send({
          error: {
            code: 'ACTIVE_BATCH_IN_PROGRESS',
            message: 'Terdapat batch laporan lain yang sedang diproses pada sesi ini. Tunggu hingga proses selesai.'
          }
        });
      }

      // 5. Input validation (size, extension, non-empty)
      const inputVal = validateReportInput(text, filename, config.maxInputBytes);
      if (!inputVal.valid) {
        return reply.code(422).send({
          error: {
            code: inputVal.error?.code || 'INVALID_INPUT',
            message: inputVal.error?.message || 'Laporan tidak valid.'
          }
        });
      }

      // Pesan pertama pada sesi: agen diminta membaca rekap tersimpan lebih dulu.
      const firstTurn = repo.countBatches(sessionId) === 0;

      // 6. PII filtering
      const { filteredText, piiSummary } = filterPii(text);

      // 7. Create batch in DB
      const batch = repo.createBatch({
        sessionId,
        requestId,
        contextId: session.context_id,
        sourceSha256: createHash('sha256').update(text, 'utf8').digest('hex'),
        sourceLength: inputVal.byteLength,
        filteredText,
        piiSummary
      });

      repo.touchSession(sessionId);

      // 8. Fire async processing in background (do not block response)
      setImmediate(() => {
        orchestrator.processBatchMessage({
          sessionId,
          batchId: batch.batch_id,
          requestId,
          contextId: session.context_id,
          filteredText,
          firstTurn
        }).catch((err) => {
          // Handled inside orchestrator
        });
      });

      return reply.code(202).send({
        batch_id: batch.batch_id,
        status: batch.status,
        filtered_text: filteredText,
        pii_summary: piiSummary
      });
    });
  };
}
