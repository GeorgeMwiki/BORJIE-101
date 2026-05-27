/**
 * `@borjie/cognitive-composition` — public surface.
 *
 * Composition root that wires the 12 cognitive subsystems into one named
 * pipeline plus an operator-grade 12-wire health probe persisted to
 * `cognitive_wiring_health` (migration 0076).
 *
 * Quick start:
 *
 *   import { createCognitiveComposition } from '@borjie/cognitive-composition';
 *
 *   const composition = createCognitiveComposition({
 *     inference, memoryTiers, cot, substrate, kernel,
 *     calibration, conformal, audit, brainRouter, healthStore,
 *   });
 *
 *   const output = await composition.compose({
 *     tenantId, turnId, userMessage: 'Audit last shift.',
 *   });
 *
 *   const report = await composition.wireHealth(); // 12 wires
 *
 * Source of truth: `Docs/DESIGN/NEURO_WIRING_SOTA_2026.md` §6 + §8.
 */

// ── Public factory ───────────────────────────────────────────────────────
export { createCognitiveComposition } from './composer.js';

// ── Wire-health probe (also exported so operators can run ad-hoc) ────────
export {
  runWireHealth,
  buildDefaultProbes,
  evaluateProbeOutcome,
  raceWithTimeout,
  rollupOverall,
  type ProbeBinding,
  type RunWireHealthArgs,
} from './wire-health-probe.js';

// ── Types ────────────────────────────────────────────────────────────────
export {
  // Constants / enums
  WIRE_NAMES,
  WIRE_HEALTH_STATUSES,
  PROBE_TIMEOUT_MS,
  PROBE_DEGRADED_LATENCY_MS,
  // Core domain types
  type WireName,
  type WireHealthStatus,
  type WireHealth,
  type HealthReport,
  type CognitiveInput,
  type CognitiveOutput,
  type CognitiveComposition,
  type ProvenanceEntry,
  type MemoryTier,
  // Ports — wire adapters
  type InferencePort,
  type MemoryTierPort,
  type CotPort,
  type SubstratePort,
  type KernelPort,
  type CalibrationPort,
  type ConformalPort,
  type AuditChainPort,
  type BrainRouterPort,
  type WireHealthStore,
  type WireHealthRow,
  type WireProbeFn,
  type CompositionDeps,
  // Errors
  type CompositionErrorCode,
  WireDownError,
  CalibrationDriftError,
  MemoryTierFailureError,
  AuditChainTamperedError,
  TenantIsolationViolationError,
  // Zod schemas
  CognitiveInputSchema,
  CognitiveOutputSchema,
} from './types.js';
