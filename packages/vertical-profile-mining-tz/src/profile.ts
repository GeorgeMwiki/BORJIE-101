/**
 * Mining-TZ profile assembly (Wave VP-1).
 *
 * Builds the canonical `VerticalProfileDefinition` for `mining-tz`
 * and the `SeedBundle` consumed by `@borjie/vertical-profiles`'
 * `loadSeedProfiles` to register the only live profile at launch.
 *
 * Capability seeds — the atomic + meta capabilities the LMBM mounts
 * for any tenant pinned to `mining-tz`:
 *   - compose_doc.tumemadini-royalty
 *   - compose_doc.tra-vat-return
 *   - compose_doc.nemc-eia
 *   - compose_doc.osha-safety-audit
 *   - kyc.buyer-verify
 *   - bot.fx-window-reconcile
 *
 * @module @borjie/vertical-profile-mining-tz/profile
 */

import type {
  Citation,
  SeedBundle,
  VerticalProfileDefinition,
} from '@borjie/vertical-profiles';

import { MINING_TZ_ENTITIES } from './entities.js';
import { MINING_TZ_GLOSSARY } from './glossary.js';
import { MINING_TZ_CITATIONS, MINING_TZ_WORKFLOWS } from './workflows.js';

const ACCESSED = '2026-05-27';

// ---------------------------------------------------------------------------
// Anchor citations (universal standards inherited by mining-tz)
// ---------------------------------------------------------------------------

const ICMM_MINING_TZ: Citation = Object.freeze({
  url: 'https://www.icmm.com/en-gb/our-work/sustainability-leadership/mining-principles',
  title: 'ICMM Mining Principles 2025',
  accessedAt: ACCESSED,
});

const EITI_STANDARD_TZ: Citation = Object.freeze({
  url: 'https://eiti.org/eiti-standard',
  title: 'EITI Standard 2023 (Tanzania is an EITI implementing country)',
  accessedAt: ACCESSED,
});

const ISO_14001_TZ: Citation = Object.freeze({
  url: 'https://www.iso.org/standard/60857.html',
  title: 'ISO 14001:2015 Environmental Management Systems',
  accessedAt: ACCESSED,
});

const GRI_STANDARDS_TZ: Citation = Object.freeze({
  url: 'https://www.globalreporting.org/standards',
  title: 'GRI Standards — Mining Sector Set (GRI 14)',
  accessedAt: ACCESSED,
});

// ---------------------------------------------------------------------------
// Mining-TZ profile definition
// ---------------------------------------------------------------------------

export const MINING_TZ_CAPABILITY_SEEDS: ReadonlyArray<string> = Object.freeze([
  'compose_doc.tumemadini-royalty',
  'compose_doc.tra-vat-return',
  'compose_doc.nemc-eia',
  'compose_doc.osha-safety-audit',
  'kyc.buyer-verify',
  'bot.fx-window-reconcile',
]);

export const MINING_TZ_PROFILE: VerticalProfileDefinition = Object.freeze({
  id: 'mining-tz',
  vertical: 'mining',
  region: 'tz',
  displayName: 'Mining (Tanzania)',
  status: 'live',
  description:
    'Live profile — Tanzanian mining sector (gold, tanzanite, copper, tantalite, gemstone). Regulators: TRA (revenue), Tumemadini (Mining Commission), NEMC (environment), BoT (FX), OSHA-TZ (safety). Borjie launch beachhead — the only live vertical profile at GA per FOUNDER_LOCKED_DECISIONS_2026_05_26_addendum_universal §1.',
  entities: MINING_TZ_ENTITIES,
  glossary: MINING_TZ_GLOSSARY,
  regulatorBindings: Object.freeze([
    Object.freeze({
      regulatorId: 'tz-tra',
      filingKinds: Object.freeze([
        'vat-monthly',
        'corporate-income',
        'paye-monthly',
        'sdl-skills-development-levy',
      ]),
    }),
    Object.freeze({
      regulatorId: 'tz-tumemadini',
      filingKinds: Object.freeze([
        'royalty-annual',
        'royalty-quarterly',
        'royalty-monthly',
        'kyc-verification',
        'mineral-licence-renewal',
      ]),
    }),
    Object.freeze({
      regulatorId: 'tz-nemc',
      filingKinds: Object.freeze(['eia', 'environmental-audit']),
    }),
    Object.freeze({
      regulatorId: 'tz-bot',
      filingKinds: Object.freeze(['fx-quarterly', 'gold-window-monthly']),
    }),
    Object.freeze({
      regulatorId: 'tz-osha',
      filingKinds: Object.freeze(['workplace-safety-audit']),
    }),
  ]),
  capabilitySeeds: MINING_TZ_CAPABILITY_SEEDS,
  provenance: Object.freeze([
    ICMM_MINING_TZ,
    EITI_STANDARD_TZ,
    ISO_14001_TZ,
    GRI_STANDARDS_TZ,
    ...MINING_TZ_CITATIONS,
  ]),
  implementationPackage: '@borjie/vertical-profile-mining-tz',
});

/**
 * Build the canonical mining-tz seed bundle consumed by
 * `@borjie/vertical-profiles`' `loadSeedProfiles`. Idempotent — the
 * same frozen profile + workflow references on every call.
 */
export function buildMiningTzBundle(): SeedBundle {
  return Object.freeze({
    profiles: Object.freeze([MINING_TZ_PROFILE]),
    workflows: MINING_TZ_WORKFLOWS,
  });
}
