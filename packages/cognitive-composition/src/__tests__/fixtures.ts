/**
 * Test doubles — in-memory adapters that satisfy every wire port. The
 * defaults form a fully-wired happy-path composition. Each helper takes
 * optional overrides so individual tests can flip a single wire down,
 * raise calibration drift, etc., without re-declaring the whole graph.
 */

import { createHash } from 'node:crypto';
import {
  WIRE_NAMES,
  type AuditChainPort,
  type BrainRouterPort,
  type CalibrationPort,
  type CognitiveInput,
  type CompositionDeps,
  type ConformalPort,
  type CotPort,
  type InferencePort,
  type KernelPort,
  type MemoryTier,
  type MemoryTierPort,
  type SubstratePort,
  type WireHealthRow,
  type WireHealthStore,
  type WireName,
} from '../types.js';

// ---------------------------------------------------------------------------
// In-memory health store with tenant isolation enforced at the store layer.
// ===========================================================================

export interface InMemoryHealthStoreState {
  readonly rows: Map<string, WireHealthRow>;
}

export interface InMemoryHealthStore extends WireHealthStore {
  readonly state: InMemoryHealthStoreState;
  readonly listAll: () => ReadonlyArray<WireHealthRow>;
}

export function createInMemoryHealthStore(): InMemoryHealthStore {
  const state: InMemoryHealthStoreState = { rows: new Map() };

  return {
    state,
    async upsert(row: WireHealthRow): Promise<void> {
      const key = `${row.tenantId}::${row.wireName}`;
      // Per coding-style: never mutate the input row; map.set with a copy.
      state.rows.set(key, { ...row });
    },
    async list(tenantId: string): Promise<ReadonlyArray<WireHealthRow>> {
      // Tenant isolation enforced at the store boundary.
      const out: WireHealthRow[] = [];
      for (const [key, row] of state.rows.entries()) {
        if (key.startsWith(`${tenantId}::`)) {
          out.push({ ...row });
        }
      }
      return out;
    },
    listAll(): ReadonlyArray<WireHealthRow> {
      return [...state.rows.values()].map((r) => ({ ...r }));
    },
  };
}

// ---------------------------------------------------------------------------
// In-memory audit chain — real sha256, no I/O.
// ===========================================================================

export interface InMemoryChainEntry {
  readonly index: number;
  readonly prevHash: string;
  readonly rowHash: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface InMemoryAuditPort extends AuditChainPort {
  readonly chain: ReadonlyArray<InMemoryChainEntry>;
  readonly tamper: (atIndex: number) => void;
}

const GENESIS_HASH = 'GENESIS';

function canonical(obj: Readonly<Record<string, unknown>>): string {
  const keys = Object.keys(obj).sort();
  const ordered: Record<string, unknown> = {};
  for (const k of keys) {
    ordered[k] = obj[k];
  }
  return JSON.stringify(ordered);
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

export function createInMemoryAuditPort(opts?: {
  readonly failOnAppend?: boolean;
  readonly slowAppendMs?: number;
}): InMemoryAuditPort {
  let chain: InMemoryChainEntry[] = [];

  const port: InMemoryAuditPort = {
    async append(payload) {
      if (opts?.failOnAppend === true) {
        throw new Error('audit-hash-chain.append: deliberately broken');
      }
      if (opts?.slowAppendMs !== undefined) {
        await new Promise((resolve) => setTimeout(resolve, opts.slowAppendMs));
      }
      const prevHash =
        chain.length > 0 ? chain[chain.length - 1]!.rowHash : GENESIS_HASH;
      const rowHash = sha256(canonical({ prev: prevHash, payload }));
      const entry: InMemoryChainEntry = {
        index: chain.length,
        prevHash,
        rowHash,
        payload: { ...payload },
      };
      // Recreate the array (immutability) but keep a stable mutable
      // reference inside the closure for the test-only `tamper` hook.
      chain = [...chain, entry];
      // Patch the outer-exposed `chain` so test assertions stay live.
      (port as { chain: ReadonlyArray<InMemoryChainEntry> }).chain = chain;
      return { rowHash, prevHash };
    },
    async verify(input) {
      for (let i = 0; i < input.length; i += 1) {
        const entry = input[i]!;
        const expectedPrev =
          i === 0 ? GENESIS_HASH : input[i - 1]!.rowHash;
        if (entry.prevHash !== expectedPrev) {
          return { ok: false, firstBrokenIndex: i };
        }
        const expectedHash = sha256(
          canonical({ prev: entry.prevHash, payload: entry.payload }),
        );
        if (entry.rowHash !== expectedHash) {
          return { ok: false, firstBrokenIndex: i };
        }
      }
      return { ok: true, firstBrokenIndex: null };
    },
    async probe() {
      if (opts?.failOnAppend === true) {
        throw new Error('audit-hash-chain.probe: broken');
      }
      return 'ok';
    },
    chain,
    tamper(atIndex: number) {
      if (chain[atIndex] === undefined) {
        throw new Error(`No chain entry at index ${atIndex}`);
      }
      const tampered = chain.map((e, idx) =>
        idx === atIndex
          ? { ...e, payload: { ...e.payload, _tampered: true } }
          : e,
      );
      chain = tampered;
      (port as { chain: ReadonlyArray<InMemoryChainEntry> }).chain = chain;
    },
  };
  return port;
}

// ---------------------------------------------------------------------------
// Inference port — returns canned text + confidence; configurable failure.
// ===========================================================================

export function createInferencePort(opts?: {
  readonly fail?: boolean;
  readonly confidence?: number;
  readonly slowMs?: number;
}): InferencePort {
  return {
    async infer(input: CognitiveInput) {
      if (opts?.fail === true) {
        throw new Error('cognitive-engine.inference: deliberately broken');
      }
      if (opts?.slowMs !== undefined) {
        await new Promise((resolve) => setTimeout(resolve, opts.slowMs));
      }
      return {
        text: `inference(${input.userMessage})`,
        confidence: opts?.confidence ?? 0.85,
      };
    },
    async probe() {
      if (opts?.fail === true) {
        throw new Error('cognitive-engine.probe: broken');
      }
      if (opts?.slowMs !== undefined) {
        await new Promise((resolve) => setTimeout(resolve, opts.slowMs));
      }
      return 'ok';
    },
  };
}

// ---------------------------------------------------------------------------
// Memory tier ports — one per tier, each independently failable.
// ===========================================================================

export interface MemoryTierOpts {
  readonly fail?: boolean;
  readonly empty?: boolean;
  readonly slowMs?: number;
}

export function createMemoryTierPort(
  tier: MemoryTier,
  opts?: MemoryTierOpts,
): MemoryTierPort {
  return {
    tier,
    async recall(_tenantId: string, query: string) {
      if (opts?.fail === true) {
        throw new Error(`cognitive-memory.${tier}: deliberately broken`);
      }
      if (opts?.slowMs !== undefined) {
        await new Promise((resolve) => setTimeout(resolve, opts.slowMs));
      }
      if (opts?.empty === true) {
        return [];
      }
      return [
        { cellId: `${tier}-cell-1`, text: `recall(${tier}, ${query})` },
      ];
    },
    async probe() {
      if (opts?.fail === true) {
        throw new Error(`cognitive-memory.${tier}: probe broken`);
      }
      if (opts?.slowMs !== undefined) {
        await new Promise((resolve) => setTimeout(resolve, opts.slowMs));
      }
      return 'ok';
    },
  };
}

// ---------------------------------------------------------------------------
// CoT, substrate, kernel, brain-router, conformal, calibration ports
// ===========================================================================

export function createCotPort(opts?: {
  readonly fail?: boolean;
}): CotPort {
  return {
    async cot({ prompt }) {
      if (opts?.fail === true) {
        throw new Error('extended-reasoning.cot: broken');
      }
      return { trace: [`think(${prompt})`, 'verify', 'compose'] };
    },
    async probe() {
      if (opts?.fail === true) {
        throw new Error('extended-reasoning.cot: probe broken');
      }
      return 'ok';
    },
  };
}

export function createSubstratePort(opts?: {
  readonly fail?: boolean;
}): SubstratePort {
  return {
    async compile({ task }) {
      if (opts?.fail === true) {
        throw new Error('reasoning-substrate.compile: broken');
      }
      return { programId: `prog-${task.slice(0, 8)}` };
    },
    async probe() {
      if (opts?.fail === true) {
        throw new Error('reasoning-substrate.probe: broken');
      }
      return 'ok';
    },
  };
}

export function createKernelPort(opts?: {
  readonly fail?: boolean;
}): KernelPort {
  return {
    async hook() {
      if (opts?.fail === true) {
        throw new Error('central-intelligence.kernel: broken');
      }
    },
    async probe() {
      if (opts?.fail === true) {
        throw new Error('central-intelligence.kernel: probe broken');
      }
      return 'ok';
    },
  };
}

export function createCalibrationPort(opts?: {
  readonly driftScore?: number;
  readonly fail?: boolean;
}): CalibrationPort {
  return {
    async observe() {
      if (opts?.fail === true) {
        throw new Error('calibration-monitor: broken');
      }
      return { driftScore: opts?.driftScore ?? 0.1 };
    },
    async probe() {
      if (opts?.fail === true) {
        throw new Error('calibration-monitor: probe broken');
      }
      return 'ok';
    },
  };
}

export function createConformalPort(opts?: {
  readonly fail?: boolean;
}): ConformalPort {
  return {
    async update() {
      if (opts?.fail === true) {
        throw new Error('conformal-calibration-online: broken');
      }
      return { alpha: 0.1 };
    },
    async probe() {
      if (opts?.fail === true) {
        throw new Error('conformal: probe broken');
      }
      return 'ok';
    },
  };
}

export function createBrainRouterPort(opts?: {
  readonly fail?: boolean;
}): BrainRouterPort {
  return {
    async cascade({ prompt }) {
      if (opts?.fail === true) {
        throw new Error('brain-llm-router: broken');
      }
      return { text: `router(${prompt})`, modelId: 'claude-opus-4-7' };
    },
    async probe() {
      if (opts?.fail === true) {
        throw new Error('brain-llm-router: probe broken');
      }
      return 'ok';
    },
  };
}

// ---------------------------------------------------------------------------
// buildDeps — fully wired happy-path graph with surgical overrides
// ===========================================================================

export interface BuildDepsOptions {
  readonly inference?: Parameters<typeof createInferencePort>[0];
  readonly memory?: Partial<Record<MemoryTier, MemoryTierOpts>>;
  readonly cot?: Parameters<typeof createCotPort>[0];
  readonly substrate?: Parameters<typeof createSubstratePort>[0];
  readonly kernel?: Parameters<typeof createKernelPort>[0];
  readonly calibration?: Parameters<typeof createCalibrationPort>[0];
  readonly conformal?: Parameters<typeof createConformalPort>[0];
  readonly brainRouter?: Parameters<typeof createBrainRouterPort>[0];
  readonly audit?: Parameters<typeof createInMemoryAuditPort>[0];
  readonly driftThreshold?: number;
  readonly criticalWires?: ReadonlyArray<WireName>;
  readonly nowIso?: string;
}

export interface BuiltDeps {
  readonly deps: CompositionDeps;
  readonly auditPort: InMemoryAuditPort;
  readonly healthStore: InMemoryHealthStore;
}

export function buildDeps(opts: BuildDepsOptions = {}): BuiltDeps {
  const auditPort = createInMemoryAuditPort(opts.audit);
  const healthStore = createInMemoryHealthStore();

  const deps: CompositionDeps = {
    inference: createInferencePort(opts.inference),
    memoryTiers: {
      episodic: createMemoryTierPort('episodic', opts.memory?.episodic),
      semantic: createMemoryTierPort('semantic', opts.memory?.semantic),
      procedural: createMemoryTierPort('procedural', opts.memory?.procedural),
      reflective: createMemoryTierPort('reflective', opts.memory?.reflective),
    },
    cot: createCotPort(opts.cot),
    substrate: createSubstratePort(opts.substrate),
    kernel: createKernelPort(opts.kernel),
    calibration: createCalibrationPort(opts.calibration),
    conformal: createConformalPort(opts.conformal),
    audit: auditPort,
    brainRouter: createBrainRouterPort(opts.brainRouter),
    healthStore,
    ...(opts.driftThreshold !== undefined
      ? { driftThreshold: opts.driftThreshold }
      : {}),
    ...(opts.criticalWires !== undefined
      ? { criticalWires: opts.criticalWires }
      : {}),
    clock: { nowIso: () => opts.nowIso ?? '2026-05-27T00:00:00.000Z' },
  };

  return { deps, auditPort, healthStore };
}

export const ALL_WIRES: ReadonlyArray<WireName> = WIRE_NAMES;
