/**
 * routing-config/seam-adapter.ts — the LIVE-SEAM bridge between the
 * config-driven canonical ladder and a route's concrete provider entries.
 *
 * The live chat seams (owner brain-call + public-chat SSE) do NOT call
 * brainCall(); they bind concrete provider adapters (Anthropic / OpenAI /
 * DeepSeek), each pre-tagged with a raw provider model id. The admin control
 * plane, in contrast, stores CANONICAL `ModelTier` ids
 * (`anthropic/claude-opus-4-8`, `openai/gpt-5`, …).
 *
 * This module is the seam: given the config-resolved canonical ladder for a
 * (tenant, useCase) turn AND the route's live provider entries, it
 *   1. REORDERS the live entries to match the admin's ordered preference, and
 *   2. OVERRIDES each live entry's raw model id with the admin's choice for
 *      that provider family (prefix-stripped to the raw id the SDK expects).
 *
 * So the admin-set core model + ordered fallbacks + per-use-case routing take
 * effect on the live adapters WITHOUT re-plumbing the whole brainCall pipeline
 * into the streaming path.
 *
 * IP-EGRESS INVARIANT (HARD): this function only rewrites the model id passed
 * to a provider SDK server-side. It returns NO model/agent/provider names to
 * any caller that would surface them to a client — the result carries only the
 * (already-server-side) live entries with possibly-swapped ids + a telemetry
 * `source`. Routes must never echo these to the client.
 *
 * FAIL-SAFE: when the kill-switch is off, no reader is wired, no config row
 * exists, or the config maps to none of the live providers, the live entries
 * are returned UNCHANGED in their original order (today's behaviour). Never
 * throws.
 *
 * Pure module: no I/O, no mutation (returns new arrays).
 */

import type { ModelTier, TaskKind } from '../types.js';
import { normaliseModel } from '../cost-cascade/pricing.js';
import { resolveConfigDrivenLadder } from './resolver.js';

/**
 * A route's live provider entry. The `providerFamily` is the coarse provider
 * bucket the entry's adapter speaks (anthropic / openai / deepseek / google /
 * other) — the seam matches config model ids to live entries by this bucket.
 */
export interface LiveProviderEntry<T> {
  /** The raw provider model id currently bound (e.g. `claude-sonnet-4-6`). */
  readonly model: string;
  /** Coarse provider bucket used to match a canonical config id to this entry. */
  readonly providerFamily: SeamProviderFamily;
  /** The live adapter + any route-local metadata; carried through untouched. */
  readonly entry: T;
}

export type SeamProviderFamily =
  | 'anthropic'
  | 'openai'
  | 'deepseek'
  | 'google'
  | 'other';

export interface ApplyConfigRoutingArgs<T> {
  /** Task kind for the static-ladder fallback (the resolver needs it). */
  readonly task: TaskKind;
  /** Tenant id for scope resolution (`global` fallback handled by resolver). */
  readonly tenantId: string;
  /** The per-use-case routing key (intent / surface), when known. */
  readonly useCase?: string;
  /** The route's live provider entries, in their default order. */
  readonly live: ReadonlyArray<LiveProviderEntry<T>>;
}

export interface AppliedConfigRouting<T> {
  /**
   * The live entries to try, in order. Each item is the ORIGINAL live `entry`
   * (adapter + metadata) plus the `model` id to send (possibly overridden by
   * the admin config). Server-side only — never surface to a client.
   */
  readonly ladder: ReadonlyArray<{ readonly model: string; readonly entry: T }>;
  /** Where the order/ids came from — for server-side telemetry + tests. */
  readonly source: 'admin-config' | 'static-ladder';
}

/**
 * Map a canonical `ModelTier` id to the coarse provider bucket the live seams
 * use. DeepSeek is OpenAI-wire but is a DISTINCT live adapter, so it gets its
 * own bucket; anything we do not recognise is `other` (and is ignored by the
 * seam — it can never displace a live entry it does not match).
 */
export function canonicalToFamily(model: ModelTier): SeamProviderFamily {
  const lower = model.toLowerCase();
  const prefix = lower.includes('/') ? lower.slice(0, lower.indexOf('/')) : '';
  const base = normaliseModel(lower);
  if (prefix === 'anthropic' || prefix === 'anthropic-bedrock' || prefix === 'anthropic-vertex') {
    return 'anthropic';
  }
  if (base.startsWith('deepseek')) return 'deepseek';
  if (prefix === 'openai') return 'openai';
  if (prefix === 'google') return 'google';
  // Prefix-less ids — fall back to the base id shape.
  if (base.startsWith('claude')) return 'anthropic';
  if (base.startsWith('gpt')) return 'openai';
  if (base.startsWith('gemini')) return 'google';
  return 'other';
}

/**
 * Apply the admin config-driven routing to a route's live provider entries.
 *
 * The result reorders + re-ids the live entries to honour the admin's core +
 * ordered fallbacks (and per-use-case override), restricted to the providers
 * the route actually has wired (a config model for an unconfigured provider is
 * skipped). Any live providers the config does NOT mention are appended after
 * the configured ones (so the route keeps its full fallback breadth).
 *
 * FAIL-SAFE: returns the live entries unchanged when the resolver yields the
 * static ladder, when no config provider matches a live provider, or on any
 * internal fault.
 */
export function applyConfigRouting<T>(
  args: ApplyConfigRoutingArgs<T>,
): AppliedConfigRouting<T> {
  const passthrough = (): AppliedConfigRouting<T> => ({
    ladder: args.live.map((l) => ({ model: l.model, entry: l.entry })),
    source: 'static-ladder',
  });

  if (args.live.length === 0) return passthrough();

  let resolution: ReturnType<typeof resolveConfigDrivenLadder>;
  try {
    resolution = resolveConfigDrivenLadder({
      task: args.task,
      tenantId: args.tenantId,
      ...(args.useCase !== undefined && args.useCase.length > 0
        ? { useCase: args.useCase }
        : {}),
    });
  } catch {
    // FAIL-SAFE: a resolver fault must never break the turn.
    return passthrough();
  }

  // Only the admin-config source steers the live seams. A 'static-ladder'
  // (kill-switch off / no row / bad row) or a 'call-override' (not used by
  // these seams) leaves the live entries exactly as the route built them.
  if (resolution.source !== 'admin-config' || resolution.ladder.length === 0) {
    return passthrough();
  }

  // Walk the config's ordered canonical ladder. For each canonical model, find
  // the FIRST live entry of the same provider family that we have not yet
  // placed, and bind the admin's raw model id to it. This honours both the
  // admin's chosen model AND the admin's ordering, restricted to live
  // providers.
  const placed = new Set<number>();
  const ordered: Array<{ model: string; entry: T }> = [];

  for (const canonical of resolution.ladder) {
    const family = canonicalToFamily(canonical);
    if (family === 'other') continue;
    const idx = args.live.findIndex(
      (l, i) => !placed.has(i) && l.providerFamily === family,
    );
    if (idx === -1) continue;
    placed.add(idx);
    ordered.push({
      // Send the RAW (prefix/suffix-stripped) model id the SDK expects.
      model: normaliseModel(canonical),
      entry: args.live[idx]!.entry,
    });
  }

  // No config model matched any live provider → fail safe to the live order.
  if (ordered.length === 0) return passthrough();

  // Append any live providers the config did not mention so the route keeps
  // its full fallback breadth (with their ORIGINAL ids).
  for (let i = 0; i < args.live.length; i += 1) {
    if (placed.has(i)) continue;
    ordered.push({ model: args.live[i]!.model, entry: args.live[i]!.entry });
  }

  return { ladder: ordered, source: 'admin-config' };
}
