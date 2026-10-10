import type { FastifyRequest, FastifyReply } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import type { AppConfig } from './config.js';

export function isAllowedOrigin(origin: string | undefined, allowedOrigins: string[]): boolean {
  if (!origin) return true; // Non-browser or same-origin direct request without Origin header
  const normalized = origin.trim().replace(/\/$/, '');
  return allowedOrigins.some((allowed) => allowed.replace(/\/$/, '') === normalized);
}

export function verifySessionToken(authHeader: string | undefined, expectedToken: string): boolean {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
  const provided = authHeader.slice(7).trim();
  if (provided.length !== expectedToken.length) return false;
  try {
    return timingSafeEqual(Buffer.from(provided), Buffer.from(expectedToken));
  } catch {
    return false;
  }
}

export function createSecurityHooks(config: AppConfig) {
  return {
    validateOrigin: async (request: FastifyRequest, reply: FastifyReply) => {
      const origin = request.headers.origin;
      if (origin && !isAllowedOrigin(origin, config.allowedOrigins)) {
        reply.code(403).send({
          error: {
            code: 'FORBIDDEN_ORIGIN',
            message: 'Permintaan lintas situs (Origin) tidak diizinkan.'
          }
        });
        return reply;
      }
    },

    requireAuth: async (request: FastifyRequest, reply: FastifyReply) => {
      // Allow /api/health and /api/auth/token without auth
      if (
        request.url === '/api/health' ||
        request.url.startsWith('/api/health?') ||
        request.url === '/api/auth/token' ||
        request.url.startsWith('/api/auth/token?')
      ) {
        return;
      }

      // Check origin first
      const origin = request.headers.origin;
      if (origin && !isAllowedOrigin(origin, config.allowedOrigins)) {
        reply.code(403).send({
          error: {
            code: 'FORBIDDEN_ORIGIN',
            message: 'Permintaan lintas situs (Origin) tidak diizinkan.'
          }
        });
        return reply;
      }

      // Token check
      const authHeader = request.headers.authorization;
      if (!verifySessionToken(authHeader, config.sessionToken)) {
        reply.code(401).send({
          error: {
            code: 'UNAUTHORIZED',
            message: 'Akses ditolak: token sesi lokal tidak valid atau belum disertakan.'
          }
        });
        return reply;
      }
    }
  };
}
