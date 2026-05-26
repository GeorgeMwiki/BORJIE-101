/**
 * Mining-domain government tool placeholders — Tanzanian government API
 * surfaces the Master Brain may call before the real MVP3+ integrations
 * land. Renamed from `mining-tool-stubs.ts` in SCRUB-3; every payload
 * carries `_stub: true` so downstream consumers can refuse to act on
 * pending data.
 *
 * Three external services are required by the mining Master Brain:
 *   - Bank of Tanzania (BoT) gold-window reference rate — used by the
 *     Finance + Strategy modes to value inventory and quote NSR.
 *   - National Environment Management Council (NEMC) permit portal —
 *     used by the Risk + Compliance + Build modes to verify EPP / EIA
 *     status before mechanisation.
 *   - Government e-Payment Gateway (GePG) — used by the Finance +
 *     Compliance modes to query royalty / inspection / village-tax
 *     control numbers.
 *
 * Each adapter here is a deterministic stub returning a frozen mock
 * object so the kernel's tool-execution loop runs end-to-end before the
 * concrete HTTP clients are wired. Every payload carries the
 * `_stub: true` discriminator and a `note` field so downstream consumers
 * (mode prompts, eval rigs, audit log) can tell a stubbed call apart
 * from a real one without inspecting code paths.
 *
 * See gh-issue #35: wire real API in MVP3+ — replace the three
 * executors with HTTP adapters guarded by per-tenant rate limits and
 * signed-payload caching.
 */

import { z } from 'zod';
import type {
  BrainToolRegistry,
  BrainToolSpec,
} from '@borjie/central-intelligence';

/** Common discriminator field every stub payload carries. */
const stubFlag = z.literal(true);

/** BoT gold-window — input is empty (the rate is daily-published). */
const botGoldRateInputSchema = z.object({});
const botGoldRateOutputSchema = z.object({
  _stub: stubFlag,
  source: z.literal('bot.gold-window'),
  fetchedAt: z.string(),
  rateTzsPerGram: z.number().nonnegative(),
  rateUsdPerOunce: z.number().nonnegative(),
  windowDate: z.string(),
  note: z.string(),
});

export type BotGoldRate = z.infer<typeof botGoldRateOutputSchema>;

/**
 * `botGoldWindow.fetchRate()` — fetch the daily BoT gold-window
 * reference rate. Stubbed deterministic mock.
 *
 * See gh-issue #35: wire real API in MVP3+.
 */
export async function botGoldWindowFetchRate(): Promise<BotGoldRate> {
  return Object.freeze({
    _stub: true as const,
    source: 'bot.gold-window' as const,
    fetchedAt: new Date(0).toISOString(),
    rateTzsPerGram: 0,
    rateUsdPerOunce: 0,
    windowDate: '1970-01-01',
    note: 'stub: BoT gold-window adapter not yet wired — MVP3+',
  });
}

/** NEMC permit-portal — input carries a licence/permit number. */
const nemcPermitInputSchema = z.object({
  licenceNo: z.string().min(1),
});
const nemcPermitOutputSchema = z.object({
  _stub: stubFlag,
  source: z.literal('nemc.portal'),
  licenceNo: z.string(),
  status: z.enum(['unknown', 'active', 'expired', 'suspended', 'pending']),
  permitType: z.string(),
  expiresOn: z.string().nullable(),
  fetchedAt: z.string(),
  note: z.string(),
});

export type NemcPermit = z.infer<typeof nemcPermitOutputSchema>;

/**
 * `nemcPortal.fetchPermit(licenceNo)` — query the NEMC permit portal
 * for an EPP / EIA / mining-environmental permit by reference number.
 * Stubbed deterministic mock.
 *
 * See gh-issue #35: wire real API in MVP3+.
 */
export async function nemcPortalFetchPermit(
  input: z.infer<typeof nemcPermitInputSchema>,
): Promise<NemcPermit> {
  return Object.freeze({
    _stub: true as const,
    source: 'nemc.portal' as const,
    licenceNo: input.licenceNo,
    status: 'unknown' as const,
    permitType: 'unknown',
    expiresOn: null,
    fetchedAt: new Date(0).toISOString(),
    note: 'stub: NEMC portal adapter not yet wired — MVP3+',
  });
}

/** GePG control-number query — input carries a bill / control number. */
const gepgQueryInputSchema = z.object({
  billId: z.string().min(1),
});
const gepgQueryOutputSchema = z.object({
  _stub: stubFlag,
  source: z.literal('gepg.gateway'),
  billId: z.string(),
  status: z.enum(['unknown', 'unpaid', 'paid', 'expired', 'cancelled']),
  amountTzs: z.number().nonnegative(),
  payerName: z.string(),
  dueOn: z.string().nullable(),
  fetchedAt: z.string(),
  note: z.string(),
});

export type GepgBill = z.infer<typeof gepgQueryOutputSchema>;

/**
 * `gepgGateway.queryBill(billId)` — query GePG for a control-number
 * status (royalty, inspection fee, village tax, etc.). Stubbed
 * deterministic mock.
 *
 * See gh-issue #35: wire real API in MVP3+.
 */
export async function gepgGatewayQueryBill(
  input: z.infer<typeof gepgQueryInputSchema>,
): Promise<GepgBill> {
  return Object.freeze({
    _stub: true as const,
    source: 'gepg.gateway' as const,
    billId: input.billId,
    status: 'unknown' as const,
    amountTzs: 0,
    payerName: 'stub',
    dueOn: null,
    fetchedAt: new Date(0).toISOString(),
    note: 'stub: GePG gateway adapter not yet wired — MVP3+',
  });
}

/**
 * Canonical tool names so prompt allow-lists, kernel-side audit, and
 * the persona's `tools_allowed` field stay in lockstep.
 */
export const MINING_TOOL_NAMES = Object.freeze({
  BOT_GOLD: 'tz.botGoldWindow.fetchRate',
  NEMC_PERMIT: 'tz.nemcPortal.fetchPermit',
  GEPG_BILL: 'tz.gepgGateway.queryBill',
} as const);

/**
 * Concrete `BrainToolSpec` registrations for the three TZ government
 * stubs. Every tool is `tier: 'free'` (read-only) and never requires
 * approval — they are pure intelligence queries.
 *
 * Exposed as an array so the kernel composition root can register them
 * alongside the seed PM tools without duplicating registry plumbing.
 */
export function buildMiningGovernmentToolSpecs(): ReadonlyArray<
  BrainToolSpec<unknown, unknown>
> {
  const botRateSpec: BrainToolSpec<
    z.infer<typeof botGoldRateInputSchema>,
    BotGoldRate
  > = {
    name: MINING_TOOL_NAMES.BOT_GOLD,
    description:
      'Fetch the Bank of Tanzania daily gold-window reference rate (TZS/g + USD/oz).',
    schemaIn: botGoldRateInputSchema,
    schemaOut: botGoldRateOutputSchema,
    tier: 'free',
    requiresApproval: false,
    executor: () => botGoldWindowFetchRate(),
  };
  const nemcSpec: BrainToolSpec<
    z.infer<typeof nemcPermitInputSchema>,
    NemcPermit
  > = {
    name: MINING_TOOL_NAMES.NEMC_PERMIT,
    description:
      'Query the NEMC permit portal for an EPP / EIA / mining-environmental permit by licence number.',
    schemaIn: nemcPermitInputSchema,
    schemaOut: nemcPermitOutputSchema,
    tier: 'free',
    requiresApproval: false,
    executor: (input) => nemcPortalFetchPermit(input),
  };
  const gepgSpec: BrainToolSpec<
    z.infer<typeof gepgQueryInputSchema>,
    GepgBill
  > = {
    name: MINING_TOOL_NAMES.GEPG_BILL,
    description:
      'Query the Government e-Payment Gateway (GePG) for a royalty / inspection / village-tax control number.',
    schemaIn: gepgQueryInputSchema,
    schemaOut: gepgQueryOutputSchema,
    tier: 'free',
    requiresApproval: false,
    executor: (input) => gepgGatewayQueryBill(input),
  };
  return Object.freeze([
    botRateSpec as BrainToolSpec<unknown, unknown>,
    nemcSpec as BrainToolSpec<unknown, unknown>,
    gepgSpec as BrainToolSpec<unknown, unknown>,
  ]);
}

/**
 * Register the three TZ government tool stubs on a `BrainToolRegistry`.
 * Skips any tool whose name is already present so re-registration during
 * test wiring is idempotent. Returns the list of tool names that were
 * actually registered (vs. skipped) for logging.
 */
export function registerMiningGovernmentTools(
  registry: BrainToolRegistry,
): ReadonlyArray<string> {
  const registered: string[] = [];
  for (const spec of buildMiningGovernmentToolSpecs()) {
    if (registry.get(spec.name)) {
      continue;
    }
    registry.register(spec);
    registered.push(spec.name);
  }
  return Object.freeze(registered);
}
