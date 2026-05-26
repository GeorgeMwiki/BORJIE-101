/**
 * `@borjie/vertical-profile-mining-tz` — Borjie's launch beachhead.
 *
 * The only `status: 'live'` vertical profile at GA per
 * `Docs/DESIGN/FOUNDER_LOCKED_DECISIONS_2026_05_26_addendum_universal.md` §1.
 *
 * Ships:
 *   - 10 canonical entities (Mine Site, Pit, Shaft, Stockpile, Buyer,
 *     Royalty Filing, Permit, Licence, Worker, Shift).
 *   - 6 workflows (TRA monthly VAT, Tumemadini annual royalty, NEMC EIA,
 *     BoT FX quarterly, OSHA-TZ safety audit, Buyer KYC verification).
 *   - 40-entry bilingual EN+SW glossary.
 *   - 6 capability seeds.
 *
 * Companion spec: `Docs/DESIGN/UNIVERSAL_VERTICAL_PROFILES_SPEC.md`.
 *
 * @module @borjie/vertical-profile-mining-tz
 */

// Entities
export {
  MINE_SITE_ENTITY,
  PIT_ENTITY,
  SHAFT_ENTITY,
  STOCKPILE_ENTITY,
  BUYER_ENTITY,
  ROYALTY_FILING_ENTITY,
  PERMIT_ENTITY,
  LICENCE_ENTITY,
  WORKER_ENTITY,
  SHIFT_ENTITY,
  MINING_TZ_ENTITIES,
} from './entities.js';

// Glossary
export { MINING_TZ_GLOSSARY } from './glossary.js';

// Workflows
export {
  TRA_VAT_MONTHLY,
  TUMEMADINI_ANNUAL_ROYALTY,
  NEMC_EIA,
  BOT_FX_QUARTERLY,
  OSHA_TZ_SAFETY_AUDIT,
  BUYER_KYC_VERIFICATION,
  MINING_TZ_WORKFLOWS,
  MINING_TZ_CITATIONS,
} from './workflows.js';

// Profile + seed bundle builder
export {
  MINING_TZ_PROFILE,
  MINING_TZ_CAPABILITY_SEEDS,
  buildMiningTzBundle,
} from './profile.js';
