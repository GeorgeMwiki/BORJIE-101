/**
 * Scale-fixtures — shared types.
 *
 * Each tier-specific fixture file (t1-artisanal, t2-coop, ...) exports a
 * `ScaleFixture` describing a representative tenant at that tier. The
 * fixture is pure DATA — it does not touch a DB. The optional
 * `seedFixture()` helper in `seed.ts` walks the fixture and upserts it
 * into Postgres for dev / live-test environments only.
 *
 * Keep these intentionally small (one tenant, a handful of sites /
 * workers / sales) — enough to verify the UI density at each tier
 * without bloating the live-test DB.
 */

/**
 * Local mirror of the ScaleTier union from `@borjie/owner-os-tabs`. The
 * canonical source is that package; keeping a local copy here avoids
 * adding a new runtime edge from `@borjie/database` to a UI-tier
 * package. The two MUST stay in sync — a fixture test asserts this.
 */
export type ScaleTier =
  | 't1_artisanal'
  | 't2_cooperative'
  | 't3_midtier'
  | 't4_industrial'
  | 't5_multi_country';

export interface FixtureSite {
  readonly id: string;
  readonly name: string;
  readonly mineral: string;
  readonly phase: 'exploration' | 'extraction' | 'rehabilitation';
}

export interface FixtureEmployee {
  readonly id: string;
  readonly siteId: string;
  readonly fullName: string;
  readonly role: string;
}

export interface FixtureSale {
  readonly id: string;
  readonly buyerName: string;
  readonly mineral: string;
  readonly grams: number;
  readonly priceTzs: number;
}

export interface ScaleFixture {
  readonly tier: ScaleTier;
  readonly tenantId: string;
  readonly tenantName: string;
  readonly country: string;
  readonly defaultLanguage: 'sw' | 'en';
  readonly primaryCurrency: 'TZS' | 'USD' | 'KES' | 'UGX' | 'NGN';
  /** Wizard signals captured at signup — drives auto-detect. */
  readonly scaleSignals: {
    readonly workerCount: number;
    readonly siteCount: number;
    readonly mineralCount: number;
    readonly crossBorder: boolean;
  };
  /** Sites / pits the tenant operates. Length matches siteCount. */
  readonly sites: ReadonlyArray<FixtureSite>;
  /** Workers on the books. Length matches workerCount. */
  readonly employees: ReadonlyArray<FixtureEmployee>;
  /** Sales the brain can show as "last sale" / KPI surfaces. */
  readonly sales: ReadonlyArray<FixtureSale>;
  /** Bilingual short blurb the admin-web tenant card renders. */
  readonly blurbEn: string;
  readonly blurbSw: string;
}
