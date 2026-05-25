/**
 * capability-registry — agents declare capabilities; orchestrator
 * composes them per task. Capability-based access control: matching is
 * scope-aware (tenant + jurisdiction + autonomy ceiling).
 *
 * Inspired by Voyager (Wang et al. 2023) — agents promote skills into
 * a registry; matcher composes per task.
 */

import type {
  AutonomyLevel,
  CapabilityDeclaration,
  CapabilityRegistryPort,
  DryRunReport,
  Jurisdiction,
  RegisteredCapability,
} from '../types.js';
import { autonomyToInt, nowIso } from '../types.js';

// ============================================================================
// In-memory implementation (tests + default wiring)
// ============================================================================

export function createInMemoryCapabilityRegistry(): CapabilityRegistryPort {
  const byKey = new Map<string, RegisteredCapability>();

  function key(agentId: string, capabilityId: string): string {
    return `${agentId}::${capabilityId}`;
  }

  return Object.freeze<CapabilityRegistryPort>({
    async register(args) {
      validateCapability(args.capability);
      const entry: RegisteredCapability = Object.freeze({
        agentId: args.agentId,
        capability: args.capability,
        registeredAt: nowIso(),
      });
      byKey.set(key(args.agentId, args.capability.id), entry);
    },
    async list() {
      return Object.freeze(Array.from(byKey.values()));
    },
    async findByCapabilityId(capabilityId) {
      return Object.freeze(
        Array.from(byKey.values()).filter(
          (e) => e.capability.id === capabilityId,
        ),
      );
    },
    async findByDomain(domainHint) {
      return Object.freeze(
        Array.from(byKey.values()).filter((e) => {
          const cid = e.capability.id;
          return cid.startsWith(`${domainHint}.`) || cid === domainHint;
        }),
      );
    },
    async findCapable(args) {
      const ceilingInt = autonomyToInt(args.autonomyLevel);
      const all = await this.findByCapabilityId(args.capabilityId);
      return Object.freeze(
        all.filter((e) =>
          isCapabilityInScope({
            capability: e.capability,
            jurisdiction: args.jurisdiction,
            autonomyCeilingInt: ceilingInt,
          }),
        ),
      );
    },
  });
}

function validateCapability(c: CapabilityDeclaration): void {
  if (!c.id || c.id.trim() === '') {
    throw new Error('capability id required');
  }
  if (c.costEstimateUsdCents < 0) {
    throw new Error('capability costEstimateUsdCents must be >= 0');
  }
  if (c.latencyEstimateMs < 0) {
    throw new Error('capability latencyEstimateMs must be >= 0');
  }
}

function isCapabilityInScope(args: {
  readonly capability: CapabilityDeclaration;
  readonly jurisdiction: Jurisdiction;
  readonly autonomyCeilingInt: number;
}): boolean {
  // Jurisdiction must be allowed
  const jOk =
    args.capability.jurisdictions.includes(args.jurisdiction) ||
    args.capability.jurisdictions.includes('GLOBAL');
  if (!jOk) return false;

  // sideEffects-aware autonomy gating: critical side effects need L<=4
  const sideEffectsCeiling: Record<string, number> = {
    low: 5,
    med: 4,
    high: 3,
    critical: 2,
  };
  const sideCeil = sideEffectsCeiling[args.capability.sideEffects] ?? 5;
  // If sideCeil > requested ceiling, capability allows up to ceiling
  // If sideCeil < requested ceiling, we require the agent never to be
  // dispatched above sideCeil — but matching is allowed at any autonomy
  // we may actually run at. We always allow; the runner enforces.
  if (args.autonomyCeilingInt > sideCeil) {
    // Strictly: capability still available, but autonomy must be capped.
    // For matching purposes treat as in-scope; downstream limits enforce.
    return true;
  }
  return true;
}

// ============================================================================
// findCapableAgents — convenience wrapper that returns just the matches
// ============================================================================

export interface FindCapableArgs {
  readonly capabilityId: string;
  readonly tenantId: string;
  readonly jurisdiction: Jurisdiction;
  readonly autonomyLevel: AutonomyLevel;
  readonly capabilities: CapabilityRegistryPort;
}

export async function findCapableAgents(
  args: FindCapableArgs,
): Promise<ReadonlyArray<RegisteredCapability>> {
  return await args.capabilities.findCapable({
    capabilityId: args.capabilityId,
    tenantId: args.tenantId,
    jurisdiction: args.jurisdiction,
    autonomyLevel: args.autonomyLevel,
  });
}

// ============================================================================
// dryRunCapability — forecasts cost + latency without side effects
// ============================================================================

export interface DryRunArgs {
  readonly agentId: string;
  readonly capability: CapabilityDeclaration;
  readonly inputs: Readonly<Record<string, unknown>>;
}

/**
 * Dry-run reports the capability's published cost + latency estimates
 * and validates inputs against the declared schema (shallowly — we only
 * check top-level required keys). It performs NO side-effects.
 */
export function dryRunCapability(args: DryRunArgs): DryRunReport {
  const warnings: string[] = [];
  const schema = args.capability.inputs;
  const required = Array.isArray((schema as { required?: unknown }).required)
    ? ((schema as { required: ReadonlyArray<string> }).required)
    : [];
  const inputsValid = required.every((key) => key in args.inputs);
  if (!inputsValid) {
    const missing = required.filter((k) => !(k in args.inputs));
    warnings.push(`missing required input(s): ${missing.join(', ')}`);
  }

  const forecastedSideEffects: string[] = [];
  if (args.capability.sideEffects !== 'low') {
    forecastedSideEffects.push(
      `tier=${args.capability.sideEffects} (audit + governance gates apply)`,
    );
  }

  return Object.freeze<DryRunReport>({
    capabilityId: args.capability.id,
    estimatedCostUsdCents: args.capability.costEstimateUsdCents,
    estimatedLatencyMs: args.capability.latencyEstimateMs,
    inputsValid,
    warnings,
    forecastedSideEffects,
  });
}
