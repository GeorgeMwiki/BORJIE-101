/**
 * Correlation engine — given a domain question, surface the strongest
 * cross-domain edges currently touching the asked-about state.
 *
 * Pure async function. No I/O, no module-level state. Consumers (brain
 * tools) supply a tenant scope; the engine reads from the signal graph
 * (frozen, in-memory) and a small `LiveSignalProbe` port that maps a
 * tenant + node into a `present | absent` boolean. The probe is injected
 * at call time so unit tests stay deterministic.
 *
 * Contract:
 *   correlate({ domain, scope, probe }) → { touches: TouchEdge[] }
 *
 * Where:
 *   - `domain` is the domain the question is about (compliance, finance, …)
 *   - `scope` is the tenant + optional siteId scope
 *   - `probe` returns `true` when the node is currently lit on the
 *     tenant's panel (e.g. NEMC EIA amber, fuel stock low). The engine
 *     surfaces only edges where the `from` side is currently lit, so
 *     the answer is grounded in real present-tense state.
 */

import {
  SIGNAL_EDGES,
  domainOf,
  topTouchesForNode,
  type SignalEdge,
} from './signal-graph';
import type { DomainId } from '../domain-depth/types';

export interface CorrelationScope {
  readonly tenantId: string;
  readonly siteId?: string;
}

export type LiveSignalProbe = (nodeId: string, scope: CorrelationScope) => Promise<boolean>;

export interface TouchEdge {
  readonly from: string;
  readonly to: string;
  readonly touchedDomain: DomainId;
  readonly strength: number;
  readonly lagDays: number;
  readonly direction: 'forward' | 'bidirectional';
  readonly kind: 'causal' | 'correlational' | 'composite';
  readonly rationale: string;
}

export interface CorrelationResult {
  readonly domain: DomainId;
  readonly touches: ReadonlyArray<TouchEdge>;
  readonly probedNodes: number;
}

export interface CorrelateInput {
  readonly domain: DomainId;
  readonly scope: CorrelationScope;
  readonly probe?: LiveSignalProbe;
  readonly limit?: number;
}

const DEFAULT_LIMIT = 3;

const ALWAYS_PRESENT_PROBE: LiveSignalProbe = async () => true;

/**
 * Compute the strongest current cross-domain touches for a domain.
 *
 * 1. Find every node belonging to the asked-about domain.
 * 2. For each node, ask the probe whether it is currently lit on the
 *    tenant. If not, skip.
 * 3. Collect outbound edges to OTHER domains (excluding the asked-about
 *    domain itself).
 * 4. Keep the best (highest strength) edge per touched domain.
 * 5. Return the top `limit` (default 3).
 *
 * Defensive: if the probe throws on any node, treat that node as absent
 * (correlations cannot fabricate state).
 */
export async function correlate(
  input: CorrelateInput,
): Promise<CorrelationResult> {
  const limit = input.limit ?? DEFAULT_LIMIT;
  const probe = input.probe ?? ALWAYS_PRESENT_PROBE;
  const domain = input.domain;

  const ownNodes = collectDomainNodes(domain);
  if (ownNodes.length === 0) {
    return Object.freeze({ domain, touches: Object.freeze([]), probedNodes: 0 });
  }

  let probedNodes = 0;
  const litNodes: string[] = [];
  for (const nodeId of ownNodes) {
    try {
      const lit = await probe(nodeId, input.scope);
      probedNodes += 1;
      if (lit) litNodes.push(nodeId);
    } catch {
      probedNodes += 1;
    }
  }

  const bestPerDomain = new Map<DomainId, SignalEdge>();
  for (const nodeId of litNodes) {
    const touches = topTouchesForNode(nodeId, limit * 2);
    for (const e of touches) {
      const targetNode = e.from === nodeId ? e.to : e.from;
      const targetDomain = domainOf(targetNode);
      if (!targetDomain || targetDomain === domain) continue;
      const existing = bestPerDomain.get(targetDomain);
      if (!existing || existing.strength < e.strength) {
        bestPerDomain.set(targetDomain, e);
      }
    }
  }

  const ranked = Array.from(bestPerDomain.entries())
    .sort(([, a], [, b]) => b.strength - a.strength)
    .slice(0, limit);

  const touches: TouchEdge[] = ranked.map(([touchedDomain, e]) => ({
    from: e.from,
    to: e.to,
    touchedDomain,
    strength: e.strength,
    lagDays: e.lagDays,
    direction: e.direction,
    kind: e.kind,
    rationale: e.rationale,
  }));

  return Object.freeze({
    domain,
    touches: Object.freeze(touches),
    probedNodes,
  });
}

/** Return every node referenced by any edge whose prefix is the domain. */
function collectDomainNodes(domain: DomainId): ReadonlyArray<string> {
  const nodes = new Set<string>();
  for (const e of SIGNAL_EDGES) {
    if (domainOf(e.from) === domain) nodes.add(e.from);
    if (domainOf(e.to) === domain) nodes.add(e.to);
  }
  return Array.from(nodes);
}
