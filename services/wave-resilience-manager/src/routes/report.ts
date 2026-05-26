/**
 * `GET /report` — current wave health for the admin UI.
 *
 * Returns a JSON document of the form:
 *   { service: 'wave-resilience-manager', waves: WaveHealthRow[] }
 *
 * Pulls the latest progress row per wave_id from the injected
 * repository. No tenant scoping (the manager is platform-level).
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ProgressRepository } from '../storage/progress-repository.js';
import type { WaveHealthRow } from '../types.js';

export interface ReportHandlerDeps {
  readonly progress: ProgressRepository;
  readonly serviceName?: string;
}

export function buildReportHandler(deps: ReportHandlerDeps): (
  req: IncomingMessage,
  res: ServerResponse,
) => Promise<void> {
  return async function reportHandler(_req, res) {
    const latest = await deps.progress.listLatestPerWave();
    const waves: WaveHealthRow[] = latest.map((e) => ({
      wave_id: e.wave_id,
      status: e.status,
      last_checkpoint_label: e.checkpoint_label,
      last_heartbeat_at: e.heartbeat_at,
      attempt_number: e.attempt_number,
      created_at: e.created_at,
    }));
    const body = {
      service: deps.serviceName ?? 'wave-resilience-manager',
      generated_at: new Date().toISOString(),
      waves,
    };
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(body));
  };
}
