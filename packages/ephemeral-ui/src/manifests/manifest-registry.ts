/**
 * `manifest-registry.ts` — registry where functions declare their UI manifests.
 *
 * In-process, module-singleton. Keyed by `${function_id}@${version}`.
 * Pure registration (no async, no I/O). Validates structurally before
 * inserting.
 */
import type { FunctionUIManifest } from '../types.js';
import {
  assertValidManifest,
  validateFunctionUIManifest,
} from './manifest-validator.js';

interface RegistryState {
  readonly byKey: Map<string, FunctionUIManifest>;
  readonly latestVersionByFn: Map<string, number>;
}

function createState(): RegistryState {
  return {
    byKey: new Map(),
    latestVersionByFn: new Map(),
  };
}

let state: RegistryState = createState();

function keyOf(function_id: string, version: number): string {
  return `${function_id}@${version}`;
}

/**
 * Registers a manifest. Throws if invalid. Re-registering the same
 * `(function_id, version)` tuple is a no-op when the candidate is
 * structurally identical (deep-equal on the structural projection);
 * otherwise it throws to surface accidental divergence.
 */
export function registerFunctionUIManifest(candidate: unknown): FunctionUIManifest {
  assertValidManifest(candidate);
  const manifest: FunctionUIManifest = candidate;
  const k = keyOf(manifest.function_id, manifest.version);

  const existing = state.byKey.get(k);
  if (existing) {
    if (manifestsStructurallyEqual(existing, manifest)) {
      return existing;
    }
    throw new Error(
      `Manifest divergence: ${k} already registered with a different shape.`,
    );
  }

  state.byKey.set(k, manifest);
  const cur = state.latestVersionByFn.get(manifest.function_id) ?? -1;
  if (manifest.version > cur) {
    state.latestVersionByFn.set(manifest.function_id, manifest.version);
  }
  return manifest;
}

/** Returns the manifest at an exact version, or `null`. */
export function getManifest(
  function_id: string,
  version: number,
): FunctionUIManifest | null {
  return state.byKey.get(keyOf(function_id, version)) ?? null;
}

/** Returns the highest-versioned manifest for `function_id`, or `null`. */
export function getLatestManifest(
  function_id: string,
): FunctionUIManifest | null {
  const v = state.latestVersionByFn.get(function_id);
  if (v === undefined) {
    return null;
  }
  return state.byKey.get(keyOf(function_id, v)) ?? null;
}

/** Test-only: reset the registry. Throws when called outside vitest. */
export function __resetRegistryForTests(): void {
  // Detect vitest via the globally-injected sentinel.
  const isTest =
    typeof process !== 'undefined' &&
    typeof process.env !== 'undefined' &&
    (process.env['NODE_ENV'] === 'test' || process.env['VITEST'] === 'true');
  if (!isTest) {
    throw new Error('__resetRegistryForTests may only be called in test runs');
  }
  state = createState();
}

/** Lists all registered (function_id, version) pairs. Used by introspection. */
export function listRegisteredManifests(): ReadonlyArray<{
  readonly function_id: string;
  readonly version: number;
}> {
  return Array.from(state.byKey.values()).map((m) => ({
    function_id: m.function_id,
    version: m.version,
  }));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function manifestsStructurallyEqual(
  a: FunctionUIManifest,
  b: FunctionUIManifest,
): boolean {
  // Compare everything except the opaque `output_shape` (Zod schemas
  // can be reference-different but semantically equal — we trust the
  // version pin).
  if (a.function_id !== b.function_id) return false;
  if (a.version !== b.version) return false;
  if (a.dashboard_archetype !== b.dashboard_archetype) return false;
  if (a.authority_tier !== b.authority_tier) return false;
  if (a.ephemeral_by_default !== b.ephemeral_by_default) return false;
  if (a.cache_ttl_seconds !== b.cache_ttl_seconds) return false;
  if (
    JSON.stringify(a.ui_hints) !== JSON.stringify(b.ui_hints) ||
    JSON.stringify(a.required_context) !== JSON.stringify(b.required_context) ||
    JSON.stringify(a.allowed_actions ?? null) !==
      JSON.stringify(b.allowed_actions ?? null)
  ) {
    return false;
  }
  return true;
}

/** Re-export the validator for callers that only need the read side. */
export { validateFunctionUIManifest };
