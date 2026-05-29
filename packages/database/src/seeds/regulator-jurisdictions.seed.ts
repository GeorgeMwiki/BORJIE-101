/**
 * Regulator-jurisdictions seed — issue #207 (world-scale tenants), WS-3.
 *
 * Populates the tenant-AGNOSTIC `regulator_jurisdictions` catalogue
 * (migration 0143) with the platform's launch jurisdictions:
 *
 *   TZ — PCCB, NEMC, EITI, TMAA
 *   KE — Mining Office (State Dept of Mining), NEMA, EITI Kenya
 *   UG — Directorate of Geological Survey & Mines (DGSM), NEMA-UG, EITI Uganda
 *   NG — Ministry of Mines & Steel Development (MMSD), NESREA, NEITI
 *   ZA — Department of Mineral Resources & Energy (DMRE), DEAT, EITI-ZA
 *   AU — Geoscience Australia (federal), EPA Victoria (state), DJPR
 *   CL — SERNAGEOMIN, COCHILCO, Comisión Chilena del Cobre
 *   ID — ESDM, MEMR
 *   generic — fallback set for jurisdictions Borjie hasn't onboarded
 *
 * Idempotent. Upserts on (regulator_set, slug) so re-running the seed
 * is safe. Same execution shape as `borjie-mining-demo.seed.ts`.
 *
 * Run:
 *   pnpm tsx packages/database/src/seeds/regulator-jurisdictions.seed.ts
 */

import postgres from 'postgres';
import { logger } from '../logger.js';

interface JurisdictionRow {
  readonly countryCode: string;
  readonly nameEn: string;
  readonly nameLocal: string | null;
  readonly slug: string;
  readonly regulatorSet: string;
  readonly mandate: string;
  readonly contactUrl: string | null;
  readonly dsrEndpoint: string | null;
  readonly licenceRenewalEndpoint: string | null;
  readonly attributes: Record<string, unknown>;
}

const REGULATOR_ROWS: ReadonlyArray<JurisdictionRow> = Object.freeze([
  // ── Tanzania (TZ-set) ─────────────────────────────────────────────────────
  {
    countryCode: 'TZ',
    nameEn: 'Prevention and Combating of Corruption Bureau',
    nameLocal: 'Taasisi ya Kuzuia na Kupambana na Rushwa',
    slug: 'pccb',
    regulatorSet: 'TZ-set',
    mandate: 'anti-corruption',
    contactUrl: 'https://www.pccb.go.tz',
    dsrEndpoint: null,
    licenceRenewalEndpoint: null,
    attributes: { region: 'East Africa' },
  },
  {
    countryCode: 'TZ',
    nameEn: 'National Environment Management Council',
    nameLocal: 'Baraza la Taifa la Hifadhi na Usimamizi wa Mazingira',
    slug: 'nemc',
    regulatorSet: 'TZ-set',
    mandate: 'environment',
    contactUrl: 'https://www.nemc.or.tz',
    dsrEndpoint: null,
    licenceRenewalEndpoint: null,
    attributes: {},
  },
  {
    countryCode: 'TZ',
    nameEn: 'Extractive Industries Transparency Initiative (TZ chapter)',
    nameLocal: 'EITI Tanzania',
    slug: 'eiti',
    regulatorSet: 'TZ-set',
    mandate: 'transparency-eiti',
    contactUrl: 'https://www.teiti.go.tz',
    dsrEndpoint: null,
    licenceRenewalEndpoint: null,
    attributes: {},
  },
  {
    countryCode: 'TZ',
    nameEn: 'Tanzania Minerals Audit Agency',
    nameLocal: 'Wakala wa Ukaguzi wa Madini Tanzania',
    slug: 'tmaa',
    regulatorSet: 'TZ-set',
    mandate: 'royalty',
    contactUrl: 'https://www.tmaa.go.tz',
    dsrEndpoint: null,
    licenceRenewalEndpoint: null,
    attributes: {},
  },

  // ── Kenya (KE-set) ────────────────────────────────────────────────────────
  {
    countryCode: 'KE',
    nameEn: 'State Department of Mining',
    nameLocal: 'Idara ya Madini',
    slug: 'state-dept-mining-ke',
    regulatorSet: 'KE-set',
    mandate: 'mining-licensing',
    contactUrl: 'https://www.mining.go.ke',
    dsrEndpoint: null,
    licenceRenewalEndpoint: null,
    attributes: {},
  },
  {
    countryCode: 'KE',
    nameEn: 'National Environment Management Authority',
    nameLocal: 'Mamlaka ya Usimamizi wa Mazingira',
    slug: 'nema-ke',
    regulatorSet: 'KE-set',
    mandate: 'environment',
    contactUrl: 'https://www.nema.go.ke',
    dsrEndpoint: null,
    licenceRenewalEndpoint: null,
    attributes: {},
  },
  {
    countryCode: 'KE',
    nameEn: 'Extractive Industries Transparency Initiative (KE chapter)',
    nameLocal: 'EITI Kenya',
    slug: 'eiti-ke',
    regulatorSet: 'KE-set',
    mandate: 'transparency-eiti',
    contactUrl: null,
    dsrEndpoint: null,
    licenceRenewalEndpoint: null,
    attributes: {},
  },

  // ── Uganda (UG-set) ───────────────────────────────────────────────────────
  {
    countryCode: 'UG',
    nameEn: 'Directorate of Geological Survey and Mines',
    nameLocal: null,
    slug: 'dgsm-ug',
    regulatorSet: 'UG-set',
    mandate: 'mining-licensing',
    contactUrl: 'https://www.energyandminerals.go.ug',
    dsrEndpoint: null,
    licenceRenewalEndpoint: null,
    attributes: {},
  },
  {
    countryCode: 'UG',
    nameEn: 'National Environment Management Authority',
    nameLocal: null,
    slug: 'nema-ug',
    regulatorSet: 'UG-set',
    mandate: 'environment',
    contactUrl: 'https://www.nema.go.ug',
    dsrEndpoint: null,
    licenceRenewalEndpoint: null,
    attributes: {},
  },
  {
    countryCode: 'UG',
    nameEn: 'Extractive Industries Transparency Initiative (UG chapter)',
    nameLocal: null,
    slug: 'eiti-ug',
    regulatorSet: 'UG-set',
    mandate: 'transparency-eiti',
    contactUrl: null,
    dsrEndpoint: null,
    licenceRenewalEndpoint: null,
    attributes: {},
  },

  // ── Nigeria (NG-set) ──────────────────────────────────────────────────────
  {
    countryCode: 'NG',
    nameEn: 'Ministry of Mines and Steel Development',
    nameLocal: null,
    slug: 'mmsd-ng',
    regulatorSet: 'NG-set',
    mandate: 'mining-licensing',
    contactUrl: 'https://www.mines.gov.ng',
    dsrEndpoint: null,
    licenceRenewalEndpoint: null,
    attributes: {},
  },
  {
    countryCode: 'NG',
    nameEn: 'National Environmental Standards and Regulations Enforcement Agency',
    nameLocal: null,
    slug: 'nesrea-ng',
    regulatorSet: 'NG-set',
    mandate: 'environment',
    contactUrl: 'https://www.nesrea.gov.ng',
    dsrEndpoint: null,
    licenceRenewalEndpoint: null,
    attributes: {},
  },
  {
    countryCode: 'NG',
    nameEn: 'Nigeria Extractive Industries Transparency Initiative',
    nameLocal: null,
    slug: 'neiti-ng',
    regulatorSet: 'NG-set',
    mandate: 'transparency-eiti',
    contactUrl: 'https://www.neiti.gov.ng',
    dsrEndpoint: null,
    licenceRenewalEndpoint: null,
    attributes: {},
  },

  // ── South Africa (ZA-set) ────────────────────────────────────────────────
  {
    countryCode: 'ZA',
    nameEn: 'Department of Mineral Resources and Energy',
    nameLocal: null,
    slug: 'dmre-za',
    regulatorSet: 'ZA-set',
    mandate: 'mining-licensing',
    contactUrl: 'https://www.dmre.gov.za',
    dsrEndpoint: null,
    licenceRenewalEndpoint: null,
    attributes: {},
  },
  {
    countryCode: 'ZA',
    nameEn: 'Department of Forestry, Fisheries and the Environment',
    nameLocal: null,
    slug: 'deat-za',
    regulatorSet: 'ZA-set',
    mandate: 'environment',
    contactUrl: 'https://www.dffe.gov.za',
    dsrEndpoint: null,
    licenceRenewalEndpoint: null,
    attributes: {},
  },

  // ── Australia (AU-set) ───────────────────────────────────────────────────
  {
    countryCode: 'AU',
    nameEn: 'Geoscience Australia',
    nameLocal: null,
    slug: 'geoscience-au',
    regulatorSet: 'AU-set',
    mandate: 'mining-licensing',
    contactUrl: 'https://www.ga.gov.au',
    dsrEndpoint: null,
    licenceRenewalEndpoint: null,
    attributes: { tier: 'federal' },
  },
  {
    countryCode: 'AU',
    nameEn: 'Environment Protection Authority Victoria',
    nameLocal: null,
    slug: 'epa-vic-au',
    regulatorSet: 'AU-set',
    mandate: 'environment',
    contactUrl: 'https://www.epa.vic.gov.au',
    dsrEndpoint: null,
    licenceRenewalEndpoint: null,
    attributes: { tier: 'state', state: 'Victoria' },
  },
  {
    countryCode: 'AU',
    nameEn: 'Department of Jobs, Precincts and Regions',
    nameLocal: null,
    slug: 'djpr-au',
    regulatorSet: 'AU-set',
    mandate: 'safety',
    contactUrl: null,
    dsrEndpoint: null,
    licenceRenewalEndpoint: null,
    attributes: { tier: 'state' },
  },

  // ── Chile (CL-set) ───────────────────────────────────────────────────────
  {
    countryCode: 'CL',
    nameEn: 'Servicio Nacional de Geología y Minería',
    nameLocal: 'SERNAGEOMIN',
    slug: 'sernageomin-cl',
    regulatorSet: 'CL-set',
    mandate: 'mining-licensing',
    contactUrl: 'https://www.sernageomin.cl',
    dsrEndpoint: null,
    licenceRenewalEndpoint: null,
    attributes: {},
  },
  {
    countryCode: 'CL',
    nameEn: 'Comisión Chilena del Cobre',
    nameLocal: 'COCHILCO',
    slug: 'cochilco-cl',
    regulatorSet: 'CL-set',
    mandate: 'royalty',
    contactUrl: 'https://www.cochilco.cl',
    dsrEndpoint: null,
    licenceRenewalEndpoint: null,
    attributes: {},
  },

  // ── Indonesia (ID-set) ───────────────────────────────────────────────────
  {
    countryCode: 'ID',
    nameEn: 'Ministry of Energy and Mineral Resources',
    nameLocal: 'Kementerian Energi dan Sumber Daya Mineral',
    slug: 'esdm-id',
    regulatorSet: 'ID-set',
    mandate: 'mining-licensing',
    contactUrl: 'https://www.esdm.go.id',
    dsrEndpoint: null,
    licenceRenewalEndpoint: null,
    attributes: {},
  },
  {
    countryCode: 'ID',
    nameEn: 'Mineral and Energy Resources Regulator',
    nameLocal: 'MEMR',
    slug: 'memr-id',
    regulatorSet: 'ID-set',
    mandate: 'royalty',
    contactUrl: null,
    dsrEndpoint: null,
    licenceRenewalEndpoint: null,
    attributes: {},
  },

  // ── Generic fallback (no-jurisdiction-onboarded) ────────────────────────
  {
    countryCode: 'XX',
    nameEn: 'Generic Mining Authority (fallback)',
    nameLocal: null,
    slug: 'generic-mining-auth',
    regulatorSet: 'generic',
    mandate: 'mining-licensing',
    contactUrl: null,
    dsrEndpoint: null,
    licenceRenewalEndpoint: null,
    attributes: { fallback: true },
  },
  {
    countryCode: 'XX',
    nameEn: 'Generic Environmental Authority (fallback)',
    nameLocal: null,
    slug: 'generic-environment-auth',
    regulatorSet: 'generic',
    mandate: 'environment',
    contactUrl: null,
    dsrEndpoint: null,
    licenceRenewalEndpoint: null,
    attributes: { fallback: true },
  },
]);

function requireDatabaseUrl(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    throw new Error(
      'regulator-jurisdictions.seed: DATABASE_URL env var is required',
    );
  }
  return raw;
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production' && !process.env.SEED_ALLOW_PROD) {
    throw new Error(
      'regulator-jurisdictions.seed refuses NODE_ENV=production without SEED_ALLOW_PROD=1',
    );
  }
  const databaseUrl = requireDatabaseUrl();
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    let upserts = 0;
    for (const row of REGULATOR_ROWS) {
      await sql`
        INSERT INTO regulator_jurisdictions (
          country_code, name_en, name_local, slug, regulator_set,
          mandate, contact_url, dsr_endpoint, licence_renewal_endpoint,
          attributes
        ) VALUES (
          ${row.countryCode},
          ${row.nameEn},
          ${row.nameLocal},
          ${row.slug},
          ${row.regulatorSet},
          ${row.mandate},
          ${row.contactUrl},
          ${row.dsrEndpoint},
          ${row.licenceRenewalEndpoint},
          ${sql.json(row.attributes)}
        )
        ON CONFLICT (regulator_set, slug) DO UPDATE SET
          country_code = EXCLUDED.country_code,
          name_en = EXCLUDED.name_en,
          name_local = EXCLUDED.name_local,
          mandate = EXCLUDED.mandate,
          contact_url = EXCLUDED.contact_url,
          dsr_endpoint = EXCLUDED.dsr_endpoint,
          licence_renewal_endpoint = EXCLUDED.licence_renewal_endpoint,
          attributes = EXCLUDED.attributes,
          updated_at = now()
      `;
      upserts += 1;
    }
    logger.info('regulator-jurisdictions.seed complete', {
      rows: upserts,
      sets: 9,
    });
  } finally {
    await sql.end();
  }
}

// Only auto-run when invoked as a script (`tsx ...seed.ts`). When the
// module is imported by tests we skip the top-level execution so the
// catalogue can be inspected without a live Postgres.
const invokedAsScript =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  /regulator-jurisdictions\.seed\.[cm]?[jt]s$/.test(process.argv[1]);

if (invokedAsScript) {
  main().catch((err) => {
    logger.error('regulator-jurisdictions.seed FAILED', {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    process.exit(1);
  });
}

export { REGULATOR_ROWS, main };
