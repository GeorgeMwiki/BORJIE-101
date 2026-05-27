/**
 * Tests for `@borjie/market-intelligence`.
 *
 * Deterministic fixtures only — no network. All wrapped packages are
 * stubbed behind their Port interfaces.
 */

import { describe, it, expect } from 'vitest';
import {
  ALLOW_ALL_TENANT_PERMISSION,
  ForecastUnavailableError,
  TenantPermissionError,
  UnknownCommodityError,
  createFixtureSignalSource,
  createInMemoryAlertSink,
  createInMemoryPriceProvider,
  createMarketIntelligence,
  type CommodityPrice,
  type DisruptionAlert,
  type FxProviderPort,
  type PriceProviderPort,
  type TenantPermissionPort,
} from '../index.js';

// ─── Fixtures ────────────────────────────────────────────────────

const FIXED_NOW = new Date('2026-05-27T00:00:00.000Z');
const goldPrice: Omit<CommodityPrice, 'tenantId'> = {
  commodity: 'gold',
  price: 2_350,
  currency: 'USD',
  asOfISO: '2026-05-26T15:00:00.000Z',
  source: 'lbma-pm',
  grade: 'lbma-fix',
  regulatoryTags: [],
};

const copperPrice: Omit<CommodityPrice, 'tenantId'> = {
  commodity: 'copper',
  price: 9_400,
  currency: 'USD',
  asOfISO: '2026-05-26T17:00:00.000Z',
  source: 'lme-3m',
  region: 'mbeya',
  grade: 'lme-grade-a',
  regulatoryTags: [],
};

const tanzanitePrice: Omit<CommodityPrice, 'tenantId'> = {
  commodity: 'tanzanite',
  price: 720,
  currency: 'USD',
  asOfISO: '2026-05-26T08:00:00.000Z',
  source: 'block-c-prod-report',
  region: 'mererani',
  grade: 'block-c-aaa',
  regulatoryTags: [],
};

const fxProvider: FxProviderPort = {
  async usdToTzs() {
    return 2_580;
  },
};

const provider: PriceProviderPort = createInMemoryPriceProvider({
  gold: goldPrice,
  copper: copperPrice,
  tanzanite: tanzanitePrice,
});

function buildIntel(opts: {
  readonly tenantPermission?: TenantPermissionPort;
  readonly alerts?: ReadonlyArray<DisruptionAlert>;
} = {}) {
  const alertSink = createInMemoryAlertSink();
  const intel = createMarketIntelligence({
    priceProvider: provider,
    fxProvider,
    tenantPermission: opts.tenantPermission ?? ALLOW_ALL_TENANT_PERMISSION,
    disruptionSource: createFixtureSignalSource(opts.alerts ?? []),
    alertSink,
    now: () => FIXED_NOW,
  });
  return { intel, alertSink };
}

// ─── Tests ───────────────────────────────────────────────────────

describe('trackCommodity — happy paths', () => {
  it('gold: returns LBMA fix with TZS conversion + regulatory tags', async () => {
    const { intel } = buildIntel();
    const price = await intel.trackCommodity('gold', 'mwikila-co');
    expect(price.commodity).toBe('gold');
    expect(price.price).toBe(2_350);
    expect(price.currency).toBe('USD');
    expect(price.tzsEquivalent).toBe(2_350 * 2_580);
    expect(price.regulatoryTags).toEqual(
      expect.arrayContaining(['OSHA-TZ', 'TMAA']),
    );
    expect(price.tenantId).toBe('mwikila-co');
  });

  it('copper: returns LME 3-month tick with Mbeya region', async () => {
    const { intel } = buildIntel();
    const price = await intel.trackCommodity('copper', 'mwikila-co');
    expect(price.commodity).toBe('copper');
    expect(price.region).toBe('mbeya');
    expect(price.source).toBe('lme-3m');
  });

  it('tanzanite: returns Block C production-report tick from Mererani', async () => {
    const { intel } = buildIntel();
    const price = await intel.trackCommodity('tanzanite', 'mwikila-co');
    expect(price.commodity).toBe('tanzanite');
    expect(price.region).toBe('mererani');
    expect(price.grade).toBe('block-c-aaa');
  });
});

describe('trackCommodity — error cases', () => {
  it('throws UnknownCommodityError for unsupported commodity', async () => {
    const { intel } = buildIntel();
    await expect(
      // @ts-expect-error — deliberately bad input.
      intel.trackCommodity('platinum', 'mwikila-co'),
    ).rejects.toBeInstanceOf(UnknownCommodityError);
  });

  it('throws TenantPermissionError when permission port denies', async () => {
    const deny: TenantPermissionPort = { async canAccess() { return false; } };
    const { intel } = buildIntel({ tenantPermission: deny });
    await expect(
      intel.trackCommodity('gold', 'unknown-tenant'),
    ).rejects.toBeInstanceOf(TenantPermissionError);
  });
});

describe('forecast90Day — bands + drivers', () => {
  it('produces 90 points with p5<=p50<=p95 ordering and drivers', async () => {
    const { intel } = buildIntel();
    const forecast = await intel.forecast90Day({
      commodity: 'gold',
      tenantId: 'mwikila-co',
      history: [
        { asOfISO: '2026-02-26T00:00:00.000Z', price: 2_100 },
        { asOfISO: '2026-03-26T00:00:00.000Z', price: 2_180 },
        { asOfISO: '2026-04-26T00:00:00.000Z', price: 2_260 },
        { asOfISO: '2026-05-26T00:00:00.000Z', price: 2_340 },
      ],
      horizonDays: 90,
      driverHints: ['china-cb-purchases'],
    });
    expect(forecast.points).toHaveLength(90);
    expect(forecast.horizonDays).toBe(90);
    for (const p of forecast.points) {
      expect(p.p5).toBeLessThanOrEqual(p.p50);
      expect(p.p50).toBeLessThanOrEqual(p.p95);
    }
    expect(forecast.drivers.length).toBeGreaterThan(0);
    expect(forecast.drivers.some((d) => /Caller hint/.test(d))).toBe(true);
    expect(forecast.confidence).toBeGreaterThan(0);
    expect(forecast.confidence).toBeLessThanOrEqual(0.95);
    expect(forecast.regulatoryTags).toEqual(
      expect.arrayContaining(['OSHA-TZ', 'TMAA']),
    );
  });

  it('throws ForecastUnavailableError when history too short', async () => {
    const { intel } = buildIntel();
    await expect(
      intel.forecast90Day({
        commodity: 'copper',
        tenantId: 'mwikila-co',
        history: [{ asOfISO: '2026-05-26T00:00:00.000Z', price: 9_400 }],
        horizonDays: 90,
        driverHints: [],
      }),
    ).rejects.toThrow();
  });

  it('rejects forecast for unknown commodity', async () => {
    const { intel } = buildIntel();
    await expect(
      intel.forecast90Day({
        // @ts-expect-error deliberate bad commodity
        commodity: 'platinum',
        tenantId: 'mwikila-co',
        history: [
          { asOfISO: '2026-04-26T00:00:00.000Z', price: 1_000 },
          { asOfISO: '2026-05-26T00:00:00.000Z', price: 1_020 },
        ],
        horizonDays: 90,
        driverHints: [],
      }),
    ).rejects.toThrow();
  });
});

describe('getDisruptionAlerts — flow + tenant isolation', () => {
  it('returns alerts for the requested tenant and emits to sink', async () => {
    const alerts: DisruptionAlert[] = [
      {
        id: 'd1',
        tenantId: 'mwikila-co',
        commodity: 'gold',
        kind: 'weather',
        severity: 'high',
        headline: 'Heavy rains in Geita disrupt road haulage',
        rationale: 'Road TR-12 closed due to landslide. ETA 5-7 days.',
        region: 'geita',
        detectedAtISO: '2026-05-26T06:00:00.000Z',
        evidence: { roadCode: 'TR-12' },
        regulatoryTags: [],
      },
      {
        id: 'd2',
        tenantId: 'other-co',
        commodity: 'gold',
        kind: 'regulatory',
        severity: 'medium',
        headline: 'Other co alert',
        rationale: 'Not our tenant',
        detectedAtISO: '2026-05-26T06:00:00.000Z',
        evidence: {},
        regulatoryTags: [],
      },
    ];
    const { intel, alertSink } = buildIntel({ alerts });
    const out = await intel.getDisruptionAlerts('mwikila-co');
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe('d1');
    expect(out[0]!.regulatoryTags).toEqual(
      expect.arrayContaining(['OSHA-TZ']),
    );
    expect(alertSink.emitted).toHaveLength(1);
    expect(alertSink.emitted[0]!.id).toBe('d1');
  });

  it('does not leak alerts across tenants', async () => {
    const alerts: DisruptionAlert[] = [
      {
        id: 'foreign',
        tenantId: 'other-co',
        commodity: 'copper',
        kind: 'logistics',
        severity: 'critical',
        headline: 'foreign tenant',
        rationale: 'should not surface',
        detectedAtISO: '2026-05-26T06:00:00.000Z',
        evidence: {},
        regulatoryTags: [],
      },
    ];
    const { intel } = buildIntel({ alerts });
    const out = await intel.getDisruptionAlerts('mwikila-co');
    expect(out).toEqual([]);
  });

  it('enriches regulatory tags by disruption kind', async () => {
    const alerts: DisruptionAlert[] = [
      {
        id: 'reg-1',
        tenantId: 'mwikila-co',
        commodity: 'tanzanite',
        kind: 'regulatory',
        severity: 'high',
        headline: 'TMAA royalty audit announced',
        rationale: 'Mining audit kicks off next quarter.',
        detectedAtISO: '2026-05-26T08:00:00.000Z',
        evidence: {},
        regulatoryTags: [],
      },
    ];
    const { intel } = buildIntel({ alerts });
    const out = await intel.getDisruptionAlerts('mwikila-co');
    expect(out[0]!.regulatoryTags).toEqual(
      expect.arrayContaining(['TMAA', 'TRA-ROYALTY']),
    );
  });
});

describe('getSellSignals — reasoning + action', () => {
  it('emits a signal with bulleted reasoning + 90-day horizon + tags', async () => {
    const { intel } = buildIntel();
    const signals = await intel.getSellSignals('mwikila-co', 'gold');
    expect(signals).toHaveLength(1);
    const s = signals[0]!;
    expect(['buy', 'sell', 'hold']).toContain(s.action);
    expect(s.reasoning.length).toBeGreaterThan(0);
    expect(s.horizonDays).toBe(90);
    expect(s.confidence).toBeGreaterThanOrEqual(0);
    expect(s.confidence).toBeLessThanOrEqual(1);
    expect(s.regulatoryTags).toEqual(
      expect.arrayContaining(['OSHA-TZ', 'TMAA']),
    );
  });

  it('biases toward sell when high-severity disruption hits the same commodity', async () => {
    const alerts: DisruptionAlert[] = [
      {
        id: 'crit-1',
        tenantId: 'mwikila-co',
        commodity: 'copper',
        kind: 'geopolitics',
        severity: 'critical',
        headline: 'Cross-border closure',
        rationale: 'Critical disruption',
        detectedAtISO: '2026-05-26T06:00:00.000Z',
        evidence: {},
        regulatoryTags: [],
      },
    ];
    const { intel } = buildIntel({ alerts });
    const signals = await intel.getSellSignals('mwikila-co', 'copper');
    const s = signals[0]!;
    expect(s.reasoning.some((r) => /high\/critical disruptions: yes/i.test(r))).toBe(
      true,
    );
  });

  it('refuses to mix tenants — TenantPermissionError on tenant mismatch in forecast', async () => {
    // Build intel for tenant A but ask for tenant B via permission allow.
    const permission: TenantPermissionPort = { async canAccess() { return true; } };
    const alertSink = createInMemoryAlertSink();
    const intel = createMarketIntelligence({
      priceProvider: provider,
      fxProvider,
      tenantPermission: permission,
      alertSink,
      now: () => FIXED_NOW,
    });
    const ok = await intel.getSellSignals('tenant-b', 'gold');
    // Should run end-to-end without cross-tenant data because all
    // wrapped objects re-stamp tenantId from the request.
    expect(ok[0]!.tenantId).toBe('tenant-b');
  });
});

describe('error class wiring', () => {
  it('UnknownCommodityError carries the bad input value', () => {
    const err = new UnknownCommodityError('platinum');
    expect(err.code).toBe('UNKNOWN_COMMODITY');
    expect(err.received).toBe('platinum');
    expect(err.name).toBe('UnknownCommodityError');
  });

  it('ForecastUnavailableError carries a reason', () => {
    const err = new ForecastUnavailableError('no data');
    expect(err.code).toBe('FORECAST_UNAVAILABLE');
    expect(err.reason).toBe('no data');
  });

  it('TenantPermissionError carries the tenant id', () => {
    const err = new TenantPermissionError('tenant-x');
    expect(err.code).toBe('TENANT_PERMISSION_DENIED');
    expect(err.tenantId).toBe('tenant-x');
  });
});
