import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import type { Repository } from '../db/contract.js';
import type { BatchOrchestrator } from '../pipeline/orchestrator.js';
import { validateReportInput } from '../pipeline/inputValidation.js';
import { filterPii } from '../pipeline/pii.js';
import {csvReports} from '../pipeline/csvImport.js';
import type { AppConfig } from '../config.js';
import {StructuredCorrectionSchema,structuredCorrection} from '../pipeline/structuredCorrection.js';

const MessageBodySchema = z.object({
  request_id: z.string().min(1, 'request_id wajib diisi.'),
  text: z.string(),
  filename: z.string().optional()
  ,correction:StructuredCorrectionSchema.optional()
});

export function createMessagesRoute(
  repo: Repository,
  orchestrator: BatchOrchestrator,
  config: AppConfig
): FastifyPluginAsync {
  return async (fastify) => {
    fastify.post('/api/sessions/:id/messages', async (request, reply) => {
      const { id: sessionId } = request.params as { id: string };

      // 1. Session exists?
      const session = (await repo.getSession(sessionId));
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
            message: parseResult.error.issues[0]?.message || 'Body permintaan tidak valid.'
          }
        });
      }
      const { request_id: requestId, filename, correction } = parseResult.data;
      const structured=correction?structuredCorrection(correction):undefined;
      const text=structured?.text??parseResult.data.text;
      if(correction&&filename)return reply.code(422).send({error:{code:'INVALID_CORRECTION'}});

      // 3. Idempotency check: same request_id?
      const existingBatch = (await repo.getBatchByRequestId(requestId, sessionId));
      if (existingBatch) {
        return reply.code(200).send({
          batch_id: existingBatch.batch_id,
          status: existingBatch.status,
          filtered_text: existingBatch.filtered_text,
          pii_summary: existingBatch.pii_summary_json ? JSON.parse(existingBatch.pii_summary_json) : null
        });
      }

      // 4. Concurrency check: is there another active batch on this session?
      const activeBatch = (await repo.getActiveBatch(sessionId));
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
      const firstTurn = (await repo.countBatches(sessionId)) === 0;

      // 6. PII filtering
      const csv=filename?.toLowerCase().endsWith('.csv');
      let source=text;
      let expectedReportCount:number|undefined;
      if(csv){try{const imported=csvReports(text,config.maxInputBytes);source=imported.text;expectedReportCount=imported.rows;}catch(error){return reply.code(422).send({error:{code:'INVALID_CSV',message:error instanceof Error?error.message:'CSV tidak valid.'}});}}
      const { filteredText, piiSummary } = filterPii(source);

      // 7. Create batch in DB
      const batch = (await repo.createBatch({
        sessionId,
        requestId,
        contextId: session.context_id,
        sourceSha256: createHash('sha256').update(text, 'utf8').digest('hex'),
        sourceLength: inputVal.byteLength,
        filteredText,
        piiSummary
      }));

      (await repo.touchSession(sessionId));

      // 8. Fire async processing in background (do not block response)
      if(request.principal)orchestrator.setPrincipal(sessionId,request.principal);
      orchestrator.schedule(() =>
        orchestrator.processBatchMessage({
          sessionId,
          batchId: batch.batch_id,
          requestId,
          contextId: session.context_id,
          filteredText,
          firstTurn,
          sourceFormat:csv?'csv':undefined,
          expectedReportCount
          ,structuredRecord:structured?JSON.parse(filterPii(JSON.stringify(structured.record)).filteredText):undefined,correctionBaseKey:correction?.base_key
        })
      );

      return reply.code(202).send({
        batch_id: batch.batch_id,
        status: batch.status,
        filtered_text: filteredText,
        pii_summary: piiSummary
      });
    });
  };
}
