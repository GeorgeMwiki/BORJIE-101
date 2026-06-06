/**
 * Compliance Plugins Router
 *
 *   GET /api/v1/compliance-plugins
 *     Returns the full catalog of registered country plugins so operator
 *     UIs can populate the country-selector dropdown with real data
 *     (currency, phone prefix, KYC provider ids, payment-gateway ids).
 *
 *   GET /api/v1/compliance-plugins/controls?jurisdiction=TZ
 *     Returns the regulatory CONTROL CATALOG that applies to a
 *     jurisdiction, sourced from the `@borjie/compliance-pack` 10-
 *     framework control library (GDPR / SOC2 / ISO27001 / TZ-DPA /
 *     KE-DPA / UG-DPA / RW-DPA / NG-NDPR / POPIA / CCPA). The catalog
 *     drives the compliance cockpit's "which controls must we satisfy
 *     here" view; `GLOBAL` controls (audit standards) are always merged
 *     in alongside the jurisdiction-specific set.
 *
 * Auth is required — the endpoint is part of the admin surface; no write
 * endpoints yet. `@borjie/compliance-plugins` (country plugins) backs the
 * first route; `@borjie/compliance-pack` (framework controls) backs the
 * `/controls` route — two distinct read-only projections.
 */

import { Hono } from 'hono';
import {
  countryPluginRegistry,
  DEFAULT_COUNTRY_ID,
} from '@borjie/compliance-plugins';
import { authMiddleware } from '../middleware/hono-auth';
import type { ServiceRegistry } from '../composition/service-registry';

export const compliancePluginsRouter = new Hono();

compliancePluginsRouter.use('*', authMiddleware);

/**
 * GET / — list every registered country plugin as a thin summary.
 *
 * Shape is flattened for operator UIs — only ids and names are exposed,
 * never the raw env-var prefixes that still live in the plugin object
 * (the front-end has no business reading those).
 */
compliancePluginsRouter.get('/', (c) => {
  const plugins = countryPluginRegistry.all();
  const countries = plugins.map((plugin) => ({
    countryCode: plugin.countryCode,
    countryName: plugin.countryName,
    currencyCode: plugin.currencyCode,
    currencySymbol: plugin.currencySymbol,
    phoneCountryCode: plugin.phoneCountryCode,
    kycProviders: plugin.kycProviders.map((provider) => ({
      id: provider.id,
      name: provider.name,
      kind: provider.kind,
    })),
    paymentGateways: plugin.paymentGateways.map((gateway) => ({
      id: gateway.id,
      name: gateway.name,
      kind: gateway.kind,
    })),
    compliance: {
      minBondMonths: plugin.compliance.minBondMonths,
      maxBondMonths: plugin.compliance.maxBondMonths,
      noticePeriodDays: plugin.compliance.noticePeriodDays,
      minimumTermMonths: plugin.compliance.minimumTermMonths,
      subSupplyConsent: plugin.compliance.subSupplyConsent,
      lateFeeCapRate: plugin.compliance.lateFeeCapRate,
      bondReturnDays: plugin.compliance.bondReturnDays,
    },
  }));

  return c.json({
    success: true,
    data: {
      defaultCountryCode: DEFAULT_COUNTRY_ID,
      count: countries.length,
      countries,
    },
  });
});

/**
 * GET /controls — jurisdiction-scoped regulatory control catalog.
 *
 * Pulls the ported `@borjie/compliance-pack` namespace off the live
 * service registry (`portedDomain.compliancePack`) and INVOKES its
 * `controlsByJurisdiction` cross-reference helper. The returned controls
 * are merged with the always-applicable `GLOBAL` audit-standard controls
 * (SOC2 / ISO27001) and shaped for the compliance cockpit. This is the
 * first live consumer of the ported compliance-pack bundle — the catalog
 * output is what populates the response.
 */
compliancePluginsRouter.get('/controls', (c) => {
  const registry = c.get('services') as unknown as ServiceRegistry | undefined;
  const pack = registry?.portedDomain?.compliancePack;
  if (!pack) {
    return c.json(
      {
        success: false,
        error: { code: 'COMPLIANCE_PACK_UNAVAILABLE', message: 'Compliance control catalog not wired' },
      },
      503,
    );
  }

  const requested = c.req.query('jurisdiction')?.toUpperCase().trim();
  // Validate against the pack's own jurisdiction enum so we never query
  // with a code the catalogs don't model.
  const known = new Set<string>(pack.JURISDICTIONS as ReadonlyArray<string>);
  const jurisdiction =
    requested && known.has(requested)
      ? (requested as (typeof pack.JURISDICTIONS)[number])
      : ('TZ' as (typeof pack.JURISDICTIONS)[number]);

  // Jurisdiction-specific controls + always-on GLOBAL audit standards.
  // De-dupe on frameworkId+controlId so GLOBAL never double-counts when
  // the requested jurisdiction IS 'GLOBAL'.
  const merged = [
    ...pack.controlsByJurisdiction(jurisdiction),
    ...pack.controlsByJurisdiction('GLOBAL'),
  ];
  const seen = new Set<string>();
  const controls = merged
    .filter((entry) => {
      const key = `${entry.frameworkId}:${entry.control.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((entry) => ({
      frameworkId: entry.frameworkId,
      controlId: entry.control.id,
      name: entry.control.name,
      description: entry.control.description,
      jurisdiction: entry.control.jurisdiction,
      satisfiedBy: entry.control.satisfiedBy,
    }));

  return c.json({
    success: true,
    data: {
      jurisdiction,
      knownJurisdictions: pack.JURISDICTIONS,
      frameworks: pack.ALL_CATALOGS_LIST.map((cat) => ({
        frameworkId: cat.frameworkId,
        displayName: cat.displayName,
        version: cat.version,
        jurisdiction: cat.jurisdiction,
        controlCount: cat.controls.length,
      })),
      count: controls.length,
      controls,
    },
  });
});

export default compliancePluginsRouter;
