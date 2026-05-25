/**
 * Compliance Plugins Router
 *
 *   GET /api/v1/compliance-plugins
 *     Returns the full catalog of registered country plugins so operator
 *     UIs can populate the country-selector dropdown with real data
 *     (currency, phone prefix, KYC provider ids, payment-gateway ids).
 *
 * Auth is required — the endpoint is part of the admin surface; no write
 * endpoints yet. The source of truth is `@borjie/compliance-plugins`;
 * this router is a read-only projection of the registry.
 */

import { Hono } from 'hono';
import {
  countryPluginRegistry,
  DEFAULT_COUNTRY_ID,
} from '@borjie/compliance-plugins';
import { authMiddleware } from '../middleware/hono-auth';

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
      minDepositMonths: plugin.compliance.minDepositMonths,
      maxDepositMonths: plugin.compliance.maxDepositMonths,
      noticePeriodDays: plugin.compliance.noticePeriodDays,
      minimumLeaseMonths: plugin.compliance.minimumLeaseMonths,
      subleaseConsent: plugin.compliance.subleaseConsent,
      lateFeeCapRate: plugin.compliance.lateFeeCapRate,
      depositReturnDays: plugin.compliance.depositReturnDays,
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

export default compliancePluginsRouter;
