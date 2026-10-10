import type { FastifyPluginAsync } from 'fastify';
import type { SigapRepository } from '../db/repo.js';

export function createBatchesRoute(repo: SigapRepository): FastifyPluginAsync {
  return async (fastify) => {
    fastify.get('/api/batches/:id', async (request, reply) => {
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

      return reply.send({
        batch_id: batch.batch_id,
        session_id: batch.session_id,
        context_id: batch.context_id,
        status: batch.status,
        latest_snapshot_id: batch.latest_snapshot_id,
        latest_snapshot_sha256: batch.latest_snapshot_sha256,
        quality_status: batch.quality_status,
        preview: batch.preview_payload_json ? JSON.parse(batch.preview_payload_json) : null,
        gap: batch.gap_payload_json ? JSON.parse(batch.gap_payload_json) : null,
        bulletin: batch.bulletin_payload_json ? JSON.parse(batch.bulletin_payload_json) : null,
        created_at: batch.created_at,
        updated_at: batch.updated_at
      });
    });
  };
}
