/**
 * Adapter — bridges `@borjie/regulatory-tz-mining` to the local
 * `OshaRulebookPort` contract.
 *
 * Upstream coverage today: NEMC / TUMEMADINI / BOT / TRA / GEPG. OSHA-TZ
 * jurisdictional ruleset is on a later wave (tracked separately). Until
 * the upstream package ships an OSHA-TZ regulator, this adapter:
 *
 *   1. Calls an injectable `RegulatoryOverridesClient` if one is wired.
 *      A composition root may stand one up that reads jurisdictional
 *      overrides from elastic-config, tenant settings, or a future
 *      OSHA-TZ rule pack inside `@borjie/regulatory-tz-mining`.
 *   2. If no client is provided OR the client returns null, returns an
 *      EMPTY override set — the planner falls back to
 *      DEFAULT_OSHA_THRESHOLDS in `osha-rules.ts`.
 *   3. Emits a structured `logger.warn` event so pilots see the
 *      fallback, never silent.
 */

import type {
  Logger,
  OshaRulebookPort,
} from '../ports.js';
import { NOOP_LOGGER } from '../ports.js';

export interface OshaOverrideSet {
  readonly maxShiftHours?: number;
  readonly minRestHours?: number;
  readonly maxConsecutiveDays?: number;
  readonly undergroundMaxWeeklyHours?: number;
  readonly hazardRotationHours?: number;
  readonly heatStressTempC?: number;
}

/**
 * Contract a regulatory client must satisfy to provide OSHA-TZ flavoured
 * overrides. Composition roots wire concrete implementations behind this
 * — when the upstream package ships an OSHA-TZ regulator, a thin wrapper
 * around `createRegulatoryTzAdvisor` becomes the natural implementation.
 */
export interface RegulatoryOverridesClient {
  fetchOshaOverrides?(args: {
    readonly tenantId: string;
    readonly siteId: string;
  }): Promise<OshaOverrideSet | null>;
}

export interface CreateRegulatoryTzMiningRulebookArgs {
  /**
   * Optional client that knows how to read jurisdictional OSHA-TZ
   * overrides. Until upstream ships, this is undefined and the
   * planner uses DEFAULT_OSHA_THRESHOLDS verbatim.
   */
  readonly regulatoryClient?: RegulatoryOverridesClient;
  /** Optional structured logger. Defaults to a no-op. */
  readonly logger?: Logger;
}

/**
 * Build an `OshaRulebookPort` backed by `@borjie/regulatory-tz-mining`.
 *
 * Until upstream ships an OSHA-TZ regulator, this adapter falls back to
 * the planner's local `DEFAULT_OSHA_THRESHOLDS` and emits a structured
 * warning. The adapter NEVER throws — fatigue / heat-stress floors
 * stay enforced via DEFAULT_OSHA_THRESHOLDS even with no overrides.
 */
export function createRegulatoryTzMiningRulebook(
  args: CreateRegulatoryTzMiningRulebookArgs = {},
): OshaRulebookPort {
  const logger = args.logger ?? NOOP_LOGGER;
  return {
    async fetchOverrides({ tenantId, siteId }) {
      const client = args.regulatoryClient;
      if (!client || typeof client.fetchOshaOverrides !== 'function') {
        logger.warn(
          'mining-shift-planner.regulatory-tz.osha.fallback-defaults',
          {
            tenantId,
            siteId,
            reason: 'no-regulatory-client',
            note:
              '@borjie/regulatory-tz-mining does not yet ship an OSHA-TZ ' +
              'regulator; using DEFAULT_OSHA_THRESHOLDS.',
          },
        );
        return {};
      }
      const result = await client.fetchOshaOverrides({ tenantId, siteId });
      if (!result) {
        logger.warn(
          'mining-shift-planner.regulatory-tz.osha.fallback-defaults',
          {
            tenantId,
            siteId,
            reason: 'no-overrides-for-jurisdiction',
          },
        );
        return {};
      }
      logger.info('mining-shift-planner.regulatory-tz.osha.overrides-applied', {
        tenantId,
        siteId,
        keys: Object.keys(result),
      });
      return { ...result };
    },
  };
}
