/**
 * Universal tax-ID validator — VAT / EIN / TIN / PAN / RFC / CNPJ etc.
 *
 * The set of tax-number formats is too diverse to encode exhaustively, so
 * the validator ships a map of known countries and always returns a
 * clearly-labelled `validation-unavailable` verdict for the rest.
 */

export type TaxIdStatus = 'valid' | 'invalid' | 'validation-unavailable';

export interface TaxIdResult {
  readonly status: TaxIdStatus;
  readonly ruleId?: string;
  readonly note?: string;
}

interface TaxIdRule {
  readonly ruleId: string;
  readonly pattern: RegExp;
  readonly note: string;
}

const RULES: Readonly<Record<string, readonly TaxIdRule[]>> = Object.freeze({
  DE: [
    {
      ruleId: 'de-ustidnr',
      pattern: /^DE\d{9}$/i,
      note: 'German VAT (USt-IdNr.) — 9 digits prefixed with DE.',
    },
    {
      ruleId: 'de-steuer-id',
      pattern: /^\d{11}$/,
      note: 'German Steuer-Identifikationsnummer — 11 digits.',
    },
  ],
  FR: [
    {
      ruleId: 'fr-vat',
      pattern: /^FR[A-Z0-9]{2}\d{9}$/i,
      note: 'French VAT — FR + 2 key chars + 9 digits.',
    },
  ],
  GB: [
    {
      ruleId: 'gb-vat',
      pattern: /^GB\d{9}(\d{3})?$/i,
      note: 'UK VAT — GB + 9 (or 12) digits.',
    },
    {
      ruleId: 'gb-utr',
      pattern: /^\d{10}$/,
      note: 'UK Unique Taxpayer Reference — 10 digits.',
    },
  ],
  US: [
    {
      ruleId: 'us-ein',
      pattern: /^\d{2}-?\d{7}$/,
      note: 'US EIN — 9 digits (formatted XX-XXXXXXX).',
    },
    {
      ruleId: 'us-ssn-itin',
      pattern: /^\d{3}-?\d{2}-?\d{4}$/,
      note: 'US SSN / ITIN — 9 digits (formatted XXX-XX-XXXX).',
    },
  ],
  CA: [
    {
      ruleId: 'ca-bn',
      pattern: /^\d{9}(RT|RC|RP|RM)\d{4}$/i,
      note: 'Canadian Business Number — 9 digits + program ID + 4 digits.',
    },
  ],
  AU: [
    {
      ruleId: 'au-abn',
      pattern: /^\d{2} ?\d{3} ?\d{3} ?\d{3}$/,
      note: 'Australian Business Number — 11 digits.',
    },
  ],
  SG: [
    {
      ruleId: 'sg-uen',
      pattern: /^(\d{9}[A-Z]|\d{4}[A-Z]\d{5}[A-Z]|T\d{2}[A-Z]{2}\d{4}[A-Z])$/i,
      note: 'Singapore UEN — business / entity.',
    },
  ],
  KR: [
    {
      ruleId: 'kr-brn',
      pattern: /^\d{3}-?\d{2}-?\d{5}$/,
      note: 'Korean Business Registration Number — 10 digits.',
    },
  ],
  JP: [
    {
      ruleId: 'jp-corporate',
      pattern: /^\d{13}$/,
      note: 'Japanese Corporate Number — 13 digits.',
    },
  ],
  IN: [
    {
      ruleId: 'in-gstin',
      pattern: /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/i,
      note: 'Indian GSTIN — 15 alphanumeric.',
    },
    {
      ruleId: 'in-pan',
      pattern: /^[A-Z]{5}\d{4}[A-Z]$/i,
      note: 'Indian PAN — 10 alphanumeric.',
    },
  ],
  BR: [
    {
      ruleId: 'br-cnpj',
      pattern: /^\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}$/,
      note: 'Brazilian CNPJ — 14 digits.',
    },
  ],
  AE: [
    {
      ruleId: 'ae-trn',
      pattern: /^\d{15}$/,
      note: 'UAE Tax Registration Number — 15 digits.',
    },
  ],
  MX: [
    {
      ruleId: 'mx-rfc',
      pattern: /^[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}$/i,
      note: 'Mexican RFC — 12 (entity) or 13 (individual) chars.',
    },
  ],
  KE: [
    {
      ruleId: 'ke-pin',
      pattern: /^[A-Z]\d{9}[A-Z]$/i,
      note: 'KRA PIN — letter + 9 digits + letter.',
    },
  ],
  TZ: [
    {
      ruleId: 'tz-tin',
      pattern: /^\d{3}-?\d{3}-?\d{3}$/,
      note: 'TRA TIN — 9 digits.',
    },
  ],
  NG: [
    {
      ruleId: 'ng-tin',
      pattern: /^\d{8,10}-?\d{4}$/,
      note: 'FIRS TIN — digits + 4.',
    },
  ],
  ZA: [
    {
      ruleId: 'za-vat',
      pattern: /^4\d{9}$/,
      note: 'SARS VAT — starts with 4, 10 digits.',
    },
  ],
  UG: [
    {
      ruleId: 'ug-tin',
      pattern: /^\d{10}$/,
      note: 'URA TIN — 10 digits.',
    },
  ],
});

export function validateTaxId(raw: string, countryCode: string): TaxIdResult {
  if (!raw || raw.trim().length === 0) {
    return { status: 'invalid', note: 'Tax ID is empty.' };
  }
  const iso = countryCode.trim().toUpperCase();
  const rules = RULES[iso];
  if (!rules || rules.length === 0) {
    return {
      status: 'validation-unavailable',
      note: `No tax-ID rule registered for ${iso}; accepted as-is.`,
    };
  }
  const trimmed = raw.trim();
  for (const rule of rules) {
    if (rule.pattern.test(trimmed)) {
      return { status: 'valid', ruleId: rule.ruleId, note: rule.note };
    }
  }
  return {
    status: 'invalid',
    note: `Value did not match any registered ${iso} tax-ID format.`,
  };
}
