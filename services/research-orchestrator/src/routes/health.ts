/**
 * Health endpoint — minimal HTTP server.
 *
 * The orchestrator is a worker service but Kubernetes liveness +
 * readiness probes need an HTTP target. We expose a single
 * `GET /health` endpoint on `PORT` (default 4011) that returns:
 *
 *   { status: 'ok', service: 'research-orchestrator',
 *     uptime_s: <number>, version: <string>, started_at_iso: <iso> }
 *
 * No express dependency — just the stdlib `http` module. The server
 * exits cleanly on SIGTERM as part of the graceful-shutdown chain.
 *
 * @module research-orchestrator/routes/health
 */

import http, { type IncomingMessage, type ServerResponse } from 'node:http';

export interface HealthServerOptions {
  readonly port: number;
  readonly serviceName: string;
  readonly version?: string;
  /** Optional getter for the worker's "ready" status. */
  readonly isReady?: () => boolean;
}

export interface HealthServerHandle {
  /** Returns immediately; the server runs in the background. */
  listen(): Promise<void>;
  close(): Promise<void>;
  /** The actual port the server is listening on (may be 0-resolved). */
  port(): number;
}

export function createHealthServer(
  options: HealthServerOptions,
): HealthServerHandle {
  const startedAt = Date.now();
  const startedAtIso = new Date(startedAt).toISOString();

  const server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
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
