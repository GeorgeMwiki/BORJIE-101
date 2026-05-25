/**
 * Region-adaptive configuration registry.
 *
 * RegionConfig is country/currency/compliance only. It is NOT the location
 * hierarchy. For org-defined geographic trees (districts, regions, wards,
 * estates — with arbitrary depth and org-specific label vocabulary), see
 * `packages/domain-models/src/geo/geo-node.ts`.
 *
 * BORJIE is a GLOBAL platform. When a tenant signs up they select
 * their country/region, and everything — currency, phone format, tax
 * rates, compliance rules, timezone, locale — adapts to that selection.
 *
 * Implementation note — this module USED to keep the full country catalog
 * inline. The catalog now lives in `@borjie/compliance-plugins` so
 * every country gets the same pluggable surface (phone, currency, KYC,
 * payment rails). This module adapts the plugin's output to the legacy
 * `RegionConfig` shape and layers a small per-country `REGION_OVERLAYS`
 * table for the fields the plugin does not carry (VAT rate, timezone,
 * locale). Callers do NOT need to change — the exported API is stable.
 */

import { z } from 'zod';
import {
  getCountryPlugin,
  availableCountries,
  type CountryPlugin,
} from '@borjie/compliance-plugins';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PhoneConfig {
  readonly dialingCode: string;
  readonly nationalNumberRegex: RegExp;
  readonly placeholder: string;
}

export interface TaxConfig {
  readonly vatRate: number;
  readonly vatName: string;
  readonly rentalIncomeTaxRate: number | null;
  readonly rentalIncomeTaxName: string | null;
  readonly maxLateFeeRate: number | null;
}

export interface ComplianceConfig {
  readonly taxAuthority: string;
  readonly taxpayerIdLabel: string;
  readonly taxpayerIdRegex: RegExp | null;
  readonly businessRegLabel: string | null;
  readonly evictionNoticeDaysResidential: number;
  readonly evictionNoticeDaysCommercial: number;
  readonly depositReturnDays: number;
}

export interface MobileMoneyProvider {
  readonly id: string;
  readonly name: string;
  readonly envPrefix: string;
}

export interface RegionConfig {
  readonly countryCode: string;
  readonly countryName: string;
  readonly currencyCode: string;
  readonly currencySymbol: string;
  readonly currencyMinorUnits: number;
  readonly defaultTimezone: string;
  readonly defaultLocale: string;
  readonly phone: PhoneConfig;
  readonly tax: TaxConfig;
  readonly compliance: ComplianceConfig;
  readonly mobileMoneyProviders: readonly MobileMoneyProvider[];
}

// ---------------------------------------------------------------------------
// Per-country overlays — the fields the plugin contract does not carry
// (tax, locale, timezone, national number regex). Keep small.
// ---------------------------------------------------------------------------

interface RegionOverlay {
  readonly countryName?: string;
  readonly currencyMinorUnits?: number;
  readonly defaultTimezone: string;
  readonly defaultLocale: string;
  readonly phoneRegex: RegExp;
  readonly phonePlaceholder: string;
  readonly tax: TaxConfig;
  readonly taxAuthority: string;
  readonly taxpayerIdLabel: string;
  readonly taxpayerIdRegex: RegExp | null;
  readonly businessRegLabel: string | null;
  readonly evictionNoticeDaysResidential: number;
  readonly evictionNoticeDaysCommercial: number;
}

const REGION_OVERLAYS: Record<string, RegionOverlay> = {
  TZ: {
    currencyMinorUnits: 2,
    defaultTimezone: 'Africa/Dar_es_Salaam',
    defaultLocale: 'sw-TZ',
    phoneRegex: /^255[67]\d{8}$/,
    phonePlaceholder: '+255 7XX XXX XXX',
    tax: {
      vatRate: 0.18,
      vatName: 'VAT',
      rentalIncomeTaxRate: null,
      rentalIncomeTaxName: null,
      maxLateFeeRate: null,
    },
    taxAuthority: 'TRA',
    taxpayerIdLabel: 'TIN',
    taxpayerIdRegex: /^\d{9}$/,
    businessRegLabel: 'BRELA Registration Number',
    evictionNoticeDaysResidential: 90,
    evictionNoticeDaysCommercial: 90,
  },
  KE: {
    currencyMinorUnits: 2,
    defaultTimezone: 'Africa/Nairobi',
    defaultLocale: 'en-KE',
    phoneRegex: /^254[17]\d{8}$/,
    phonePlaceholder: '+254 7XX XXX XXX',
    tax: {
      vatRate: 0.16,
      vatName: 'VAT',
      rentalIncomeTaxRate: 0.075,
      rentalIncomeTaxName: 'MRI',
      maxLateFeeRate: 0.1,
    },
    taxAuthority: 'KRA',
    taxpayerIdLabel: 'KRA PIN',
    taxpayerIdRegex: /^[A-Z]\d{9}[A-Z]$/,
    businessRegLabel: 'Business Registration Number',
    evictionNoticeDaysResidential: 60,
    evictionNoticeDaysCommercial: 90,
  },
  UG: {
    currencyMinorUnits: 0,
    defaultTimezone: 'Africa/Kampala',
    defaultLocale: 'en-UG',
    phoneRegex: /^256[37]\d{8}$/,
    phonePlaceholder: '+256 7XX XXX XXX',
    tax: {
      vatRate: 0.18,
      vatName: 'VAT',
      rentalIncomeTaxRate: 0.2,
      rentalIncomeTaxName: 'Rental Income Tax',
      maxLateFeeRate: null,
    },
    taxAuthority: 'URA',
    taxpayerIdLabel: 'TIN',
    taxpayerIdRegex: /^\d{10}$/,
    businessRegLabel: 'URSB Registration Number',
    evictionNoticeDaysResidential: 60,
    evictionNoticeDaysCommercial: 90,
  },
  RW: {
    countryName: 'Rwanda',
    currencyMinorUnits: 0,
    defaultTimezone: 'Africa/Kigali',
    defaultLocale: 'en-RW',
    phoneRegex: /^250[78]\d{8}$/,
    phonePlaceholder: '+250 7XX XXX XXX',
    tax: {
      vatRate: 0.18,
      vatName: 'VAT',
      rentalIncomeTaxRate: 0.15,
      rentalIncomeTaxName: 'Rental Income Tax',
      maxLateFeeRate: null,
    },
    taxAuthority: 'RRA',
    taxpayerIdLabel: 'TIN',
    taxpayerIdRegex: /^\d{9}$/,
    businessRegLabel: 'RDB Registration Number',
    evictionNoticeDaysResidential: 30,
    evictionNoticeDaysCommercial: 60,
  },
};

// Rwanda is not yet a first-class plugin. A synthetic plugin-shape snapshot
// keeps `getRegionConfig('RW')` returning the legacy data without forcing
// the plugin package to ship a Rwandan plugin before we have counsel sign-off.
const RW_MOBILE_MONEY: readonly MobileMoneyProvider[] = Object.freeze([
  { id: 'mtn_rw', name: 'MTN Mobile Money', envPrefix: 'MTN_MOMO' },
  { id: 'airtel_rw', name: 'Airtel Money', envPrefix: 'AIRTELMONEY' },
]);

const RW_SYNTHETIC = {
  countryCode: 'RW',
  countryName: 'Rwanda',
  currencyCode: 'RWF',
  currencySymbol: 'FRw',
  phoneCountryCode: '250',
  mobileMoneyProviders: RW_MOBILE_MONEY,
  depositReturnDays: 30,
};

// ---------------------------------------------------------------------------
// Generic fallback
// ---------------------------------------------------------------------------

const GENERIC_CONFIG: RegionConfig = {
  countryCode: '',
  countryName: 'Unknown',
  currencyCode: 'USD',
  currencySymbol: '$',
  currencyMinorUnits: 2,
  defaultTimezone: 'UTC',
  defaultLocale: 'en',
  phone: {
    dialingCode: '',
    nationalNumberRegex: /^[1-9]\d{6,14}$/,
    placeholder: '+X XXX XXX XXXX',
  },
  tax: {
    vatRate: 0,
    vatName: 'Tax',
    rentalIncomeTaxRate: null,
    rentalIncomeTaxName: null,
    maxLateFeeRate: null,
  },
  compliance: {
    taxAuthority: '',
    taxpayerIdLabel: 'Tax ID',
    taxpayerIdRegex: null,
    businessRegLabel: null,
    evictionNoticeDaysResidential: 30,
    evictionNoticeDaysCommercial: 60,
    depositReturnDays: 30,
  },
  mobileMoneyProviders: [],
};

// ---------------------------------------------------------------------------
// Plugin → RegionConfig adapter
// ---------------------------------------------------------------------------

function mobileMoneyFromPlugin(
  plugin: CountryPlugin
): readonly MobileMoneyProvider[] {
  return Object.freeze(
    plugin.paymentGateways
      .filter((gateway) => gateway.kind === 'mobile-money')
      .map((gateway) => ({
        id: gateway.id,
        name: gateway.name,
        envPrefix: gateway.envPrefix,
      }))
  );
}

function buildFromPlugin(
  plugin: CountryPlugin,
  overlay: RegionOverlay | undefined
): RegionConfig {
  const tax: TaxConfig = overlay?.tax ?? GENERIC_CONFIG.tax;
  return {
    countryCode: plugin.countryCode,
    countryName: overlay?.countryName ?? plugin.countryName,
    currencyCode: plugin.currencyCode,
    currencySymbol: plugin.currencySymbol,
    currencyMinorUnits: overlay?.currencyMinorUnits ?? 2,
    defaultTimezone: overlay?.defaultTimezone ?? GENERIC_CONFIG.defaultTimezone,
    defaultLocale: overlay?.defaultLocale ?? GENERIC_CONFIG.defaultLocale,
    phone: {
      dialingCode: plugin.phoneCountryCode,
      nationalNumberRegex:
        overlay?.phoneRegex ?? GENERIC_CONFIG.phone.nationalNumberRegex,
      placeholder: overlay?.phonePlaceholder ?? `+${plugin.phoneCountryCode}`,
    },
    tax,
    compliance: {
      taxAuthority:
        overlay?.taxAuthority ?? GENERIC_CONFIG.compliance.taxAuthority,
      taxpayerIdLabel:
        overlay?.taxpayerIdLabel ?? GENERIC_CONFIG.compliance.taxpayerIdLabel,
      taxpayerIdRegex:
        overlay?.taxpayerIdRegex ?? GENERIC_CONFIG.compliance.taxpayerIdRegex,
      businessRegLabel:
        overlay?.businessRegLabel ?? GENERIC_CONFIG.compliance.businessRegLabel,
      evictionNoticeDaysResidential:
        overlay?.evictionNoticeDaysResidential ??
        plugin.compliance.noticePeriodDays,
      evictionNoticeDaysCommercial:
        overlay?.evictionNoticeDaysCommercial ??
        plugin.compliance.noticePeriodDays,
      depositReturnDays: plugin.compliance.depositReturnDays,
    },
    mobileMoneyProviders: mobileMoneyFromPlugin(plugin),
  };
}

function buildSyntheticRwanda(): RegionConfig {
  const overlay = REGION_OVERLAYS.RW!;
  return {
    countryCode: RW_SYNTHETIC.countryCode,
    countryName: RW_SYNTHETIC.countryName,
    currencyCode: RW_SYNTHETIC.currencyCode,
    currencySymbol: RW_SYNTHETIC.currencySymbol,
    currencyMinorUnits: overlay.currencyMinorUnits ?? 0,
    defaultTimezone: overlay.defaultTimezone,
    defaultLocale: overlay.defaultLocale,
    phone: {
      dialingCode: RW_SYNTHETIC.phoneCountryCode,
      nationalNumberRegex: overlay.phoneRegex,
      placeholder: overlay.phonePlaceholder,
    },
    tax: overlay.tax,
    compliance: {
      taxAuthority: overlay.taxAuthority,
      taxpayerIdLabel: overlay.taxpayerIdLabel,
      taxpayerIdRegex: overlay.taxpayerIdRegex,
      businessRegLabel: overlay.businessRegLabel,
      evictionNoticeDaysResidential: overlay.evictionNoticeDaysResidential,
      evictionNoticeDaysCommercial: overlay.evictionNoticeDaysCommercial,
      depositReturnDays: RW_SYNTHETIC.depositReturnDays,
    },
    mobileMoneyProviders: RW_SYNTHETIC.mobileMoneyProviders,
  };
}

// ---------------------------------------------------------------------------
// Memoised snapshots
// ---------------------------------------------------------------------------

const SUPPORTED_CODES: readonly string[] = Object.freeze(
  Array.from(
    new Set<string>([...availableCountries(), ...Object.keys(REGION_OVERLAYS)])
  )
    .map((code) => code.toUpperCase())
    .sort()
);

const cache = new Map<string, RegionConfig>();

function buildConfigFor(upper: string): RegionConfig {
  if (upper === 'RW') {
    return Object.freeze(buildSyntheticRwanda());
  }
  // Round-3 audit C6 — `getCountryPlugin` now throws
  // `UnknownJurisdictionError` for unknown codes (no more silent
  // fallback to TZ). We catch that here and fall back to the
  // GENERIC_CONFIG with the upper-cased code, preserving the
  // original `buildConfigFor` contract.
  let plugin;
  try {
    plugin = getCountryPlugin(upper);
  } catch {
    return Object.freeze({ ...GENERIC_CONFIG, countryCode: upper });
  }
  if (plugin.countryCode !== upper) {
    return Object.freeze({ ...GENERIC_CONFIG, countryCode: upper });
  }
  return Object.freeze(buildFromPlugin(plugin, REGION_OVERLAYS[upper]));
}

function resolve(upper: string): RegionConfig {
  const cached = cache.get(upper);
  if (cached) return cached;
  const built = buildConfigFor(upper);
  cache.set(upper, built);
  return built;
}

// ---------------------------------------------------------------------------
// Public API — signatures preserved
// ---------------------------------------------------------------------------

export function getRegionConfig(
  countryCode: string | null | undefined
): RegionConfig {
  if (!countryCode) return GENERIC_CONFIG;
  const upper = countryCode.trim().toUpperCase();
  if (!upper) return GENERIC_CONFIG;
  return resolve(upper);
}

export function getSupportedCountries(): readonly RegionConfig[] {
  return Object.freeze(SUPPORTED_CODES.map((code) => resolve(code)));
}

export function isCountrySupported(countryCode: string): boolean {
  return SUPPORTED_CODES.includes(countryCode.trim().toUpperCase());
}

export function normalizePhoneForCountry(
  phone: string,
  countryCode: string
): string {
  const cfg = getRegionConfig(countryCode);
  if (!cfg.phone.dialingCode) {
    return phone.replace(/\D/g, '');
  }
  const upper = (countryCode ?? '').trim().toUpperCase();
  if (upper === 'RW') {
    let cleaned = phone.replace(/\D/g, '');
    if (cleaned.startsWith('0')) {
      cleaned = cfg.phone.dialingCode + cleaned.substring(1);
    }
    if (!cleaned.startsWith(cfg.phone.dialingCode)) {
      cleaned = cfg.phone.dialingCode + cleaned;
    }
    return cleaned;
  }
  // Round-3 audit C6 — bubble through the GENERIC_CONFIG path for
  // unknown country codes instead of crashing.
  let plugin;
  try {
    plugin = getCountryPlugin(upper);
  } catch {
    return phone.replace(/\D/g, '');
  }
  const e164 = plugin.normalizePhone(phone);
  return e164.startsWith('+') ? e164.slice(1) : e164;
}

export function getDefaultCurrency(
  countryCode: string | null | undefined
): string {
  return getRegionConfig(countryCode).currencyCode;
}

/**
 * Build a Zod phone-number validator scoped to the supplied country.
 *
 * When the country is known and the plugin/overlay carries a national-
 * number regex, the schema accepts EITHER the local format (e.g.
 * `0712345678`) or the E.164 form (e.g. `+254712345678`). When the
 * country is unknown, falls back to a generic E.164 validator
 * (`^\+[1-9]\d{6,14}$`) so the platform stays usable in any jurisdiction.
 *
 * This is the world-friendly counterpart to the legacy
 * `tanzanianPhoneSchema` in `services/api-gateway/src/schemas/index.ts`.
 */
export function buildPhoneSchemaForCountry(countryCode: string | null | undefined) {
  const cfg = getRegionConfig(countryCode);
  const dialingCode = cfg.phone.dialingCode;
  const placeholder = cfg.phone.placeholder;
  const e164 = /^\+[1-9]\d{6,14}$/;
  // When we have a national-number regex AND a dialing code, accept
  // either `0XXXXXXXXX` (national-format with leading zero), the bare
  // national number (e.g. `712345678`), or the E.164 form.
  if (dialingCode) {
    const nationalRegex = cfg.phone.nationalNumberRegex;
    return z
      .string()
      .trim()
      .min(1, 'Phone number is required')
      .refine(
        (raw) => {
          if (e164.test(raw)) return true;
          const cleaned = raw.replace(/\D/g, '');
          const candidates = [
            cleaned,
            cleaned.replace(/^0/, dialingCode),
            cleaned.startsWith(dialingCode) ? cleaned : dialingCode + cleaned,
          ];
          return candidates.some((c) => nationalRegex.test(c));
        },
        { message: `Invalid phone number. Expected ${placeholder}` },
      );
  }
  return z
    .string()
    .trim()
    .regex(e164, 'Invalid phone number. Use E.164 format (e.g. +255712345678)');
}

export function buildTaxpayerIdSchema(countryCode: string) {
  const cfg = getRegionConfig(countryCode);
  const base = z
    .string()
    .trim()
    .min(1, `${cfg.compliance.taxpayerIdLabel} is required`);
  if (cfg.compliance.taxpayerIdRegex) {
    return base.transform((v) => v.toUpperCase()).refine(
      (v) => cfg.compliance.taxpayerIdRegex!.test(v),
      { message: `Invalid ${cfg.compliance.taxpayerIdLabel} format` }
    );
  }
  return base;
}
