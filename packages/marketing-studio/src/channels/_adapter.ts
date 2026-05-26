/**
 * Channel-adapter contract.
 *
 * Every adapter implements `publish(asset, ctx)` → `PublishResult`.
 * Adapters degrade gracefully when env keys are absent — they return
 * `{ ok: false, code: 'ENV_GAP' }` rather than throwing.
 */

import type { Channel, ComposedAsset } from '../types.js';

export type PublishFailureCode =
  | 'ENV_GAP'
  | 'RATE_LIMITED'
  | 'PROVIDER_ERROR'
  | 'COMPLIANCE_REFUSED'
  | 'INVARIANT_VIOLATION';

export type PublishResult =
  | {
      readonly ok: true;
      readonly channel_post_id: string;
      readonly permalink: string;
      readonly published_at: string;
    }
  | {
      readonly ok: false;
      readonly code: PublishFailureCode;
      readonly message: string;
    };

export interface PublishContext {
  readonly tenant_id: string;
  readonly dry_run?: boolean;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

export interface ChannelAdapter {
  readonly channel: Channel;
  publish(asset: ComposedAsset, ctx: PublishContext): Promise<PublishResult>;
}

/**
 * Common env-gap pattern. When any of the required env vars is
 * absent, return a structured failure (NOT throw).
 */
export function envGap(channel: Channel, missing: ReadonlyArray<string>): PublishResult {
  return {
    ok: false,
    code: 'ENV_GAP',
    message: `${channel} adapter missing env: ${missing.join(', ')}`,
  };
}

/**
 * Resolve env vars from a per-call override + process.env fallback.
 */
export function readEnv(
  keys: ReadonlyArray<string>,
  override?: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, string | undefined>> {
  const out: Record<string, string | undefined> = {};
  for (const k of keys) {
    out[k] = override?.[k] ?? process.env[k];
  }
  return Object.freeze(out);
}
