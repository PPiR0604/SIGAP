import type { FastifyPluginAsync } from 'fastify';
import type { SigapRepository } from '../db/repo.js';
import { DecisionRequestBodySchema, validateAndCreateApproval } from '../approvals/gate.js';
import type { BatchOrchestrator } from '../pipeline/orchestrator.js';

export function createDecisionsRoute(repo: SigapRepository, orchestrator: BatchOrchestrator): FastifyPluginAsync {
  return async (fastify) => {
    fastify.post('/api/batches/:id/decisions', async (request, reply) => {
      const { id: batchId } = request.params as { id: string };

      const batch = repo.getBatch(batchId);
      if (!batch) {
        return reply.code(404).send({
          error: {
            code: 'BATCH_NOT_FOUND',
            message: `Batch ${batchId} tidak ditemukan.`
          }
        });
      }
      if (orchestrator.isProcessing(batch.session_id)) {
        return reply.code(409).send({ error: { code: 'PROCESSING_IN_PROGRESS', message: 'Tunggu hingga proses kandidat selesai.' } });
      }

      const parseResult = DecisionRequestBodySchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.code(422).send({
          error: {
            code: 'INVALID_DECISION_BODY',
            message: parseResult.error.errors[0]?.message || 'Format keputusan tidak valid.'
          }
        });
      }

      // Actor is derived from session (browser does not supply arbitrary actor)
      const actorId = `operator-session-${batch.session_id.slice(0, 8)}`;

      const validation = validateAndCreateApproval(repo, batch, actorId, parseResult.data);
      if (!validation.valid) {
        const statusCode = ['SNAPSHOT_SUPERSEDED', 'SNAPSHOT_EXPIRED', 'ALREADY_APPROVED', 'WRITE_IN_PROGRESS'].includes(validation.code || '') ? 409 : 422;
        return reply.code(statusCode).send({
          error: {
            code: validation.code || 'DECISION_REJECTED',
            message: validation.message || 'Keputusan ditolak.'
          }
        });
      }

      if (validation.approval) {
        repo.updateBatchStatus(batchId, 'saving');
        setImmediate(() => { void orchestrator.continueApprovedWrite(batch, validation.approval!); });
      }
      return reply.code(validation.approval ? 202 : 200).send({
        success: true,
        action: parseResult.data.action,
        approval_id: validation.approval?.approval_id || null,
        status: validation.approval ? 'saving' : 'ready_for_review'
      });
    });
  };
}
