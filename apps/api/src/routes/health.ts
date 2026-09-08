import { type FastifyInstance, type FastifyPluginAsync } from 'fastify';
import { type Config } from '../config.js';

export interface HealthResponse {
  status: 'ok';
  uptime: number;
  version: string;
}

/**
 * Liveness only. It answers from process state and opens no connection, deliberately: a probe that
 * fails when a dependency is down turns one outage into a rolling restart of healthy machines.
 *
 * Readiness arrives with the first real dependency (`W0-T05`). A readiness probe that checks
 * nothing is worse than none, because it reports "ready" as a fact.
 */
export function healthRoutes(config: Config): FastifyPluginAsync {
  return async (app: FastifyInstance) => {
    app.get('/health', (): HealthResponse => {
      return { status: 'ok', uptime: process.uptime(), version: config.APP_VERSION };
    });
  };
}
