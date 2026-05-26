/**
 * Health endpoint — minimal stdlib HTTP server.
 *
 * Mirrors services/research-orchestrator/src/routes/health.ts so the
 * Kubernetes manifest can use the same liveness probe shape.
 */

import http, { type IncomingMessage, type ServerResponse } from 'node:http';

export interface HealthServerOptions {
  readonly port: number;
  readonly serviceName: string;
  readonly version?: string;
  readonly isReady?: () => boolean;
  readonly reportHandler?: (
    req: IncomingMessage,
    res: ServerResponse,
  ) => void | Promise<void>;
}

export interface HealthServerHandle {
  listen(): Promise<void>;
  close(): Promise<void>;
  port(): number;
}

export function createHealthServer(
  options: HealthServerOptions,
): HealthServerHandle {
  const startedAt = Date.now();
  const startedAtIso = new Date(startedAt).toISOString();

  const server = http.createServer((req, res) => {
    if (req.method !== 'GET') {
      res.statusCode = 405;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: 'method_not_allowed' }));
      return;
    }
    if (req.url === '/health' || req.url === '/healthz') {
      const ready = options.isReady ? options.isReady() : true;
      const body = {
        status: ready ? 'ok' : 'degraded',
        service: options.serviceName,
        version: options.version ?? '0.1.0',
        started_at_iso: startedAtIso,
        uptime_s: Math.floor((Date.now() - startedAt) / 1000),
      };
      res.statusCode = ready ? 200 : 503;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(body));
      return;
    }
    if (req.url === '/report' && options.reportHandler) {
      void Promise.resolve(options.reportHandler(req, res)).catch(() => {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: 'report_failed' }));
      });
      return;
    }
    res.statusCode = 404;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'not_found' }));
  });

  return {
    async listen() {
      await new Promise<void>((resolve, reject) => {
        const onError = (err: Error): void => {
          server.removeListener('listening', onListening);
          reject(err);
        };
        const onListening = (): void => {
          server.removeListener('error', onError);
          resolve();
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(options.port);
      });
    },
    async close() {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    },
    port() {
      const addr = server.address();
      if (addr && typeof addr === 'object') return addr.port;
      return options.port;
    },
  };
}
