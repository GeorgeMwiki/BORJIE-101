/**
 * PCMCIplus client — TS adapter for the Tigramite sidecar endpoint.
 *
 * PCMCIplus (Runge et al.) is the de-facto algorithm for time-series
 * causal discovery: lagged + contemporaneous links over panels.
 * Reference: https://github.com/jakobrunge/tigramite
 *
 * The Python sidecar exposes `/tigramite/pcmciplus`. This client just
 * speaks HTTP; the algorithm lives there.
 *
 * The sidecar implementation lives at
 * `services/scientific-discovery-sidecar/`. URL defaults to
 * `http://localhost:8000`; override via `DISCOVERY_SIDECAR_URL`.
 *
 * Same error model as `refutation-client.ts`.
 */

import { z } from 'zod';
import type {
  CausalDAG,
  SidecarPcmciRequest,
  SidecarPcmciResponse,
} from '../types.js';
import {
  SidecarHttpError,
  SidecarSchemaError,
  SidecarUnavailableError,
  resolveSidecarBaseUrl,
} from './refutation-client.js';

export interface PcmciClientOptions {
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

const DagEdgeWire = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  rationale: z.string().optional(),
});

const CausalDagWire = z.object({
  nodes: z.array(z.string().min(1)).min(2),
  edges: z.array(DagEdgeWire),
  candidateEdges: z
    .array(z.object({ from: z.string().min(1), to: z.string().min(1) }))
    .default([]),
});

const PcmciResponseWire = z.object({
  dag: CausalDagWire,
  pValues: z.array(z.number().min(0).max(1)),
});

export interface PcmciClient {
  pcmciplus(req: SidecarPcmciRequest): Promise<SidecarPcmciResponse>;
}

export function createPcmciClient(opts: PcmciClientOptions = {}): PcmciClient {
  const baseUrl = resolveSidecarBaseUrl(opts.baseUrl);
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 30_000;

  return {
    async pcmciplus(req) {
      const url = `${baseUrl.replace(/\/$/, '')}/tigramite/pcmciplus`;
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeoutMs);
      try {
        const res = await fetchImpl(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(req),
          signal: ctl.signal,
        });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new SidecarHttpError(res.status, text);
        }
        const raw: unknown = await res.json().catch(() => ({}));
        const parsed = PcmciResponseWire.safeParse(raw);
        if (!parsed.success) {
          throw new SidecarSchemaError(parsed.error.message);
        }
        const dag: CausalDAG = parsed.data.dag;
        return { dag, pValues: parsed.data.pValues };
      } catch (err) {
        if (err instanceof SidecarHttpError || err instanceof SidecarSchemaError) throw err;
        throw new SidecarUnavailableError(err);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
