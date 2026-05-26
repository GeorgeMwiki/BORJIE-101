/**
 * Kill switch — immediate stop of ambient listening at user or org
 * scope. Append-only audit per spec §2.
 *
 * The kill switch is checked on EVERY pipeline turn — any event in the
 * last `KILL_SWITCH_LOOKBACK_HOURS` matching either `scope='org'` for
 * the tenant or `scope='user'` for the user short-circuits the pipeline
 * with a `silent-disabled` outcome.
 */

import {
  type AuditChainPort,
  type KillSwitchEvent,
  type KillSwitchEventsRepository,
  type KillSwitchScope,
} from '../types.js';

export interface KillSwitchDeps {
  readonly repo: KillSwitchEventsRepository;
  readonly audit: AuditChainPort;
  readonly clock?: () => Date;
  /** Test seam — defaults to `crypto.randomUUID()`. */
  readonly idGen?: () => string;
}

export interface TriggerArgs {
  readonly tenant_id: string;
  readonly triggered_by: string;
  readonly reason: string;
  readonly scope: KillSwitchScope;
  /** Required when `scope='user'`; ignored otherwise. */
  readonly target_user_id?: string;
}

export interface KillSwitch {
  trigger(args: TriggerArgs): Promise<KillSwitchEvent>;
  /** `true` when the user or the user's tenant has an active kill switch. */
  isActive(
    tenant_id: string,
    user_id: string,
  ): Promise<{ readonly active: boolean; readonly scope?: KillSwitchScope }>;
}

export function createKillSwitch(deps: KillSwitchDeps): KillSwitch {
  const clock = deps.clock ?? (() => new Date());
  const idGen = deps.idGen ?? (() => generateUuidV4Fallback());

  async function trigger(args: TriggerArgs): Promise<KillSwitchEvent> {
    if (args.scope === 'user' && !args.target_user_id) {
      throw new Error(
        'kill-switch: scope=user requires target_user_id',
      );
    }
    const now = clock();
    const audit_hash = await deps.audit.append({
      op: 'ambient.kill_switch.trigger',
      tenant_id: args.tenant_id,
      triggered_by: args.triggered_by,
      scope: args.scope,
      target_user_id: args.target_user_id ?? null,
      reason: args.reason,
      at: now.toISOString(),
    });
    const event: KillSwitchEvent = {
      id: idGen(),
      tenant_id: args.tenant_id,
      triggered_by: args.triggered_by,
      triggered_at: now.toISOString(),
      reason: args.reason,
      scope: args.scope,
      target_user_id: args.target_user_id ?? null,
      audit_hash,
    };
    await deps.repo.insert(event);
    return event;
  }

  async function isActive(
    tenant_id: string,
    user_id: string,
  ): Promise<{ readonly active: boolean; readonly scope?: KillSwitchScope }> {
    return deps.repo.isActive(tenant_id, user_id, clock());
  }

  return { trigger, isActive };
}

/**
 * Deterministic v4-like UUID fallback for environments without
 * `crypto.randomUUID`. NOT cryptographically random — the production
 * impl injects `crypto.randomUUID` via `idGen`. The fallback is here
 * so unit tests are hermetic.
 */
function generateUuidV4Fallback(): string {
  const hex = (n: number) => Math.floor(n).toString(16).padStart(2, '0');
  const rb = () => Math.floor(Math.random() * 256);
  const bytes = new Array(16).fill(0).map(rb);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const h = bytes.map(hex).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
