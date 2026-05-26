/**
 * Pipeline stage 5 — writer.
 *
 * INFORMATION_SYNTHESIS_SOTA_SPEC §5: composes the rendered synthesis
 * by calling the injected WriterPort (LLM binding). The writer
 * receives reconciled clusters + disagreements; it produces a single
 * markdown body.
 *
 * When no WriterPort is injected (tests / cheap deterministic mode),
 * the writer falls back to a template renderer that emits a
 * structured, attribution-preserving summary built from the cluster
 * summaries and the disagreement list. This keeps the pipeline
 * usable in CI without an LLM dependency.
 *
 * No I/O in this module itself — the LLM call lives behind the port.
 */

import type {
  Disagreement,
  ReconciledCluster,
  WriterPort,
  WriterRequest,
} from '../types.js';

export interface WriteOptions {
  readonly port?: WriterPort;
}

export async function writeSynthesis(
  req: WriterRequest,
  options: WriteOptions = {},
): Promise<string> {
  if (options.port !== undefined) {
    const body = await options.port(req);
    return body;
  }
  return renderFallbackSynthesis(req);
}

/**
 * Deterministic fallback renderer. Used when no LLM port is wired
 * (tests, CI, smoke runs). Output is markdown with explicit cluster
 * headings + a disagreement section.
 */
export function renderFallbackSynthesis(req: WriterRequest): string {
  const parts: string[] = [];
  parts.push(`# Synthesis — ${escape(req.query)}`);
  parts.push('');

  if (req.clusters.length === 0) {
    parts.push(
      '> No clusters formed — the corpus was empty, below the relevance threshold, or insufficiently diverse.',
    );
    parts.push('');
  }

  parts.push('## Findings');
  parts.push('');
  for (const cluster of req.clusters) {
    parts.push(`### ${cluster.topic}`);
    parts.push('');
    parts.push(cluster.summary);
    parts.push('');
    if (cluster.contradictions.length > 0) {
      parts.push('Contradictions within this cluster:');
      for (const c of cluster.contradictions) {
        parts.push(`- **${escape(c.claim)}**`);
        parts.push(`- _vs_ **${escape(c.counterClaim)}**`);
      }
      parts.push('');
    }
  }

  if (req.disagreements.length > 0) {
    parts.push('## Disagreements');
    parts.push('');
    for (const d of req.disagreements) {
      parts.push(`- **${d.topic}**`);
      for (const pos of d.positions) {
        parts.push(
          `  - _${pos.stance}_: ${pos.sources.length} source${pos.sources.length === 1 ? '' : 's'}`,
        );
      }
    }
    parts.push('');
  }

  return parts.join('\n').trim();
}

// ---------------------------------------------------------------------------
// Helpers (re-exported so the test can call them deterministically)
// ---------------------------------------------------------------------------

export function buildWriterRequest(args: {
  readonly query: string;
  readonly tenantId: string;
  readonly clusters: ReadonlyArray<ReconciledCluster>;
  readonly disagreements: ReadonlyArray<Disagreement>;
}): WriterRequest {
  return Object.freeze({
    query: args.query,
    tenantId: args.tenantId,
    clusters: args.clusters,
    disagreements: args.disagreements,
  });
}

function escape(s: string): string {
  return s.replace(/[<>]/g, (c) => (c === '<' ? '&lt;' : '&gt;'));
}
