/**
 * JA-3 — Jurisdiction-aware capability resolution.
 *
 * Sibling module to capability-registry.ts. Holds per-jurisdiction
 * overrides for capability entries whose user_outcome /
 * public_description / example_response_pattern reference a
 * specific regulator / currency / licence type that changes
 * per country.
 *
 * Used by:
 *   - services/api-gateway/src/composition/brain-tools/
 *     capability-tools.ts (mwikila.capabilities.what_can_you_do +
 *     mwikila.about) to render the jurisdiction-correct example
 *     for the tenant's current country.
 *
 * Design rules:
 *   1. Overrides are PER FIELD, not per-entry. Most capabilities
 *      don't need an override — only the ones that mention PCCB /
 *      TZS / Mining Commission / etc.
 *   2. When no override is found for a (capability_id, country)
 *      pair, the default entry's value is returned. The TZ default
 *      lives in the canonical entry itself (we are TZS-first).
 *   3. The override map is FROZEN at module load — no runtime
 *      mutation.
 *   4. Country code keys are ISO-3166-1 alpha-2.
 *
 * Adding a new jurisdiction = one row in the overrides table per
 * affected capability id.
 */

import type { BilingualString } from './types.js';

/**
 * Override bundle for a single (capability, jurisdiction) pair.
 * Every field is optional — only the per-jurisdiction fields that
 * actually change need to be supplied.
 */
export interface CapabilityJurisdictionOverride {
  readonly user_outcome?: string;
  readonly public_description?: BilingualString;
  readonly example_response_pattern?: BilingualString;
}

/**
 * Frozen registry: `{ capabilityId → { ISO-alpha-2 → override } }`.
 * Only capabilities that REFERENCE a regulator / currency / licence
 * type appear here. Everything else stays jurisdiction-agnostic.
 */
export const CAPABILITY_JURISDICTION_OVERRIDES: Readonly<
  Record<string, Readonly<Record<string, CapabilityJurisdictionOverride>>>
> = Object.freeze({
  // ─────────────────────────────────────────────────────────────
  // Licence tracking — PML/ML/SML are TZ types; other jurisdictions
  // use their own licence ladders.
  // ─────────────────────────────────────────────────────────────
  'mwikila.track.licences': Object.freeze({
    KE: Object.freeze({
      user_outcome: 'Owner sees every Mining Office licence and its days-to-expiry at a glance.',
      public_description: Object.freeze({
        en: 'Prospecting Licence, Retention Licence, Mining Licence — Mr. Mwikila tracks every active permit issued by the State Department of Mining (Kenya), the days remaining, and pre-fills the quarterly review and renewal forms.',
        sw: 'Leseni ya Utafutaji, Leseni ya Uhifadhi, Leseni ya Madini — Mwikila hufuatilia kila leseni iliyotolewa na Idara ya Madini (Kenya), siku zilizobaki, na kujaza fomu za ukaguzi wa robo mwaka na upyaji.',
      }),
    }),
    UG: Object.freeze({
      public_description: Object.freeze({
        en: 'Location Licence, Mining Lease — Mr. Mwikila tracks every active permit issued by Uganda DGSM, the days remaining, and pre-fills the renewal form.',
        sw: 'Leseni ya Mahali, Mkataba wa Madini — Mwikila hufuatilia kila leseni iliyotolewa na DGSM ya Uganda, siku zilizobaki, na kujaza fomu ya upyaji.',
      }),
    }),
    NG: Object.freeze({
      user_outcome: 'Owner sees every Mining Cadastre title and its days-to-expiry at a glance.',
      public_description: Object.freeze({
        en: 'Reconnaissance Permit, Exploration Licence, Small-Scale Mining Lease, Mining Lease, Quarry Lease — Mr. Mwikila tracks every active mining title issued by the Mining Cadastre Office (Nigeria), the days remaining, and drafts the renewal to the Federal Ministry of Mines and Steel Development.',
        sw: 'Idhini ya Utambuzi, Leseni ya Uchunguzi, Mkataba wa Madini Madogo, Mkataba wa Madini, Mkataba wa Mawe — Mwikila hufuatilia kila hati ya madini iliyotolewa na Ofisi ya Cadastre ya Madini (Nigeria), siku zilizobaki, na huandaa upyaji.',
      }),
    }),
    ZA: Object.freeze({
      public_description: Object.freeze({
        en: 'Prospecting Right, Mining Right — Mr. Mwikila tracks every active right under the South African Mineral and Petroleum Resources Development Act, the days remaining, and pre-fills the DMRE renewal application.',
        sw: 'Haki ya Utafutaji, Haki ya Madini — Mwikila hufuatilia kila haki chini ya sheria ya MPRDA, siku zilizobaki, na kujaza maombi ya upyaji ya DMRE.',
      }),
    }),
    AU: Object.freeze({
      public_description: Object.freeze({
        en: 'Exploration Licence, Mining Lease — Mr. Mwikila tracks every active title under the relevant state mining authority (DMIRS WA / DRDMW QLD / NSW DPI / NT DITT), the days remaining, and pre-fills the renewal application.',
        sw: 'Leseni ya Uchunguzi, Mkataba wa Madini — Mwikila hufuatilia kila hati chini ya mamlaka husika ya jimbo, siku zilizobaki, na kujaza maombi ya upyaji.',
      }),
    }),
    CL: Object.freeze({
      public_description: Object.freeze({
        en: 'Concesión de Exploración, Concesión de Explotación — Mr. Mwikila tracks every active concession registered with Sernageomin, the days remaining, and pre-fills the annual fee submission.',
        sw: 'Concesión de Exploración, Concesión de Explotación — Mwikila hufuatilia kila concesión iliyosajiliwa Sernageomin, siku zilizobaki, na kujaza ada ya mwaka.',
      }),
    }),
    ID: Object.freeze({
      public_description: Object.freeze({
        en: 'IUP Eksplorasi, IUP Operasi Produksi — Mr. Mwikila tracks every active permit (Izin Usaha Pertambangan) issued by ESDM, the days remaining, and pre-fills the renewal form.',
        sw: 'IUP Eksplorasi, IUP Operasi Produksi — Mwikila hufuatilia kila kibali (IUP) kilichotolewa na ESDM, siku zilizobaki, na kujaza fomu ya upyaji.',
      }),
    }),
  }),

  // ─────────────────────────────────────────────────────────────
  // Licence renewal alerts — same ladder days, different regulator.
  // ─────────────────────────────────────────────────────────────
  'mwikila.alert.licence': Object.freeze({
    KE: Object.freeze({
      public_description: Object.freeze({
        en: 'Mr. Mwikila warns you 90, 60, 47, 30, and 7 days before any Kenyan mining permit expires, with the State Department of Mining renewal form already pre-filled.',
        sw: 'Mwikila hukutahadharisha siku 90, 60, 47, 30, na 7 kabla ya leseni ya Kenya kuisha, fomu ya Idara ya Madini imeshajazwa.',
      }),
    }),
    UG: Object.freeze({
      public_description: Object.freeze({
        en: 'Mr. Mwikila warns you 90, 60, 47, 30, and 7 days before any Ugandan mining permit expires, with the DGSM renewal form already pre-filled.',
        sw: 'Mwikila hukutahadharisha siku 90, 60, 47, 30, na 7 kabla ya leseni ya Uganda kuisha, fomu ya DGSM imeshajazwa.',
      }),
    }),
    NG: Object.freeze({
      public_description: Object.freeze({
        en: 'Mr. Mwikila warns you 365, 180, 90, 47, and 30 days before any Nigerian mining title expires (titles renew annually), with the Mining Cadastre Office renewal already drafted to the Federal Ministry of Mines and Steel Development.',
        sw: 'Mwikila hukutahadharisha siku 365, 180, 90, 47, na 30 kabla ya hati ya Nigeria kuisha (hupyaiwa kila mwaka), upyaji wa MCO ushaaandaliwa.',
      }),
    }),
    ZA: Object.freeze({
      public_description: Object.freeze({
        en: 'Mr. Mwikila warns you 365, 90, 47, 30, and 7 days before any South African mining right expires, with the DMRE renewal application already drafted.',
        sw: 'Mwikila hukutahadharisha siku 365, 90, 47, 30, na 7 kabla ya haki ya madini ya Afrika Kusini kuisha.',
      }),
    }),
    AU: Object.freeze({
      public_description: Object.freeze({
        en: 'Mr. Mwikila warns you 365, 90, 47, 30, and 7 days before any Australian mining tenement expires, with the state-authority renewal application already drafted.',
        sw: 'Mwikila hukutahadharisha kabla ya hati ya madini ya Australia kuisha.',
      }),
    }),
    CL: Object.freeze({
      public_description: Object.freeze({
        en: 'Mr. Mwikila warns you 90, 47, 30, and 7 days before any Chilean concesión annual fee is due, with the Sernageomin payment already queued.',
        sw: 'Mwikila hukutahadharisha kabla ya ada ya mwaka ya concesión ya Chile kufika.',
      }),
    }),
    ID: Object.freeze({
      public_description: Object.freeze({
        en: 'Mr. Mwikila warns you 180, 90, 47, 30, and 7 days before any Indonesian IUP expires, with the ESDM renewal form already pre-filled.',
        sw: 'Mwikila hukutahadharisha kabla ya IUP ya Indonesia kuisha.',
      }),
    }),
  }),

  // ─────────────────────────────────────────────────────────────
  // PCCB-named anti-corruption capability — the bureau name is
  // TZ-specific; other jurisdictions have their own equivalents.
  // ─────────────────────────────────────────────────────────────
  'mwikila.compliance.pccb': Object.freeze({
    KE: Object.freeze({
      user_outcome: 'Owner files anti-corruption disclosures to EACC on time.',
      public_description: Object.freeze({
        en: 'Mr. Mwikila drafts and tracks Ethics and Anti-Corruption Commission (EACC) self-declaration filings — beneficial owner schedules, related-party disclosures, gift register — and queues them on the EACC cadence.',
        sw: 'Mwikila huandaa na kufuatilia mafaili ya EACC — taarifa za wamiliki halisi, mahusiano, daftari la zawadi — na kuyapanga kwa ratiba ya EACC.',
      }),
    }),
    NG: Object.freeze({
      user_outcome: 'Owner files anti-corruption disclosures to EFCC + ICPC on time.',
      public_description: Object.freeze({
        en: 'Mr. Mwikila drafts and tracks Economic and Financial Crimes Commission (EFCC) and Independent Corrupt Practices Commission (ICPC) disclosures, queued on each agency cadence.',
        sw: 'Mwikila huandaa na kufuatilia mafaili ya EFCC na ICPC, yamepangwa kwa ratiba.',
      }),
    }),
    ZA: Object.freeze({
      user_outcome: 'Owner files anti-corruption disclosures to SIU / Hawks on time.',
      public_description: Object.freeze({
        en: 'Mr. Mwikila drafts and tracks Special Investigating Unit (SIU) and Directorate for Priority Crime Investigation (Hawks) disclosures.',
        sw: 'Mwikila huandaa na kufuatilia mafaili ya SIU na Hawks.',
      }),
    }),
  }),
});

/**
 * Resolve the jurisdiction-specific copy for a capability field.
 *
 * @param capabilityId the canonical id (e.g. `mwikila.track.licences`)
 * @param country ISO-3166-1 alpha-2 (e.g. `KE`); TZ returns the default
 * @returns the override bundle or null when no override exists
 */
export function getCapabilityOverride(
  capabilityId: string,
  country: string,
): CapabilityJurisdictionOverride | null {
  const upper = country.toUpperCase();
  const perCapability = CAPABILITY_JURISDICTION_OVERRIDES[capabilityId];
  if (!perCapability) return null;
  return perCapability[upper] ?? null;
}

/**
 * Returns true when the capability has at least one jurisdiction
 * override registered. Surfaces to tests + audit walkers.
 */
export function hasJurisdictionOverrides(capabilityId: string): boolean {
  return capabilityId in CAPABILITY_JURISDICTION_OVERRIDES;
}

/**
 * Returns all capability ids that have at least one jurisdiction
 * override registered. Test fixtures pin this list to detect
 * regression.
 */
export function listCapabilitiesWithOverrides(): ReadonlyArray<string> {
  return Object.freeze(Object.keys(CAPABILITY_JURISDICTION_OVERRIDES));
}
