/**
 * Universal address validator.
 *
 * Accepts a free-form address string + ISO-3166-1 country and returns a
 * best-effort structured breakdown (street, city, postal code, region).
 *
 * Design goals:
 *   - Zero external deps — purely regex + per-country rules.
 *   - Never rejects on unknown country; returns `status: 'unverified'`
 *     with the raw blob preserved.
 *   - Per-country rules live in `COUNTRY_RULES` — easy to extend.
 */

export type AddressStatus = 'valid' | 'invalid' | 'unverified';

export interface StructuredAddress {
  readonly rawInput: string;
  readonly status: AddressStatus;
  readonly street?: string;
  readonly city?: string;
  readonly postalCode?: string;
  readonly region?: string;
  readonly countryCode?: string;
  readonly missingFields?: readonly string[];
  readonly note?: string;
}

/** Minimum structural requirements per country. */
interface CountryAddressRule {
  /** Postal-code regex (anchored). */
  readonly postalCodePattern?: RegExp;
  /** Required fields beyond `street`. */
  readonly requiredFields: readonly ('city' | 'postalCode' | 'region')[];
  /** Line splitter preference — most use newlines + commas. */
  readonly separators?: readonly string[];
}

const COUNTRY_RULES: Readonly<Record<string, CountryAddressRule>> =
  Object.freeze({
    DE: {
      postalCodePattern: /^\d{5}$/,
      requiredFields: ['city', 'postalCode'],
    },
    FR: {
      postalCodePattern: /^\d{5}$/,
      requiredFields: ['city', 'postalCode'],
    },
    GB: {
      postalCodePattern: /^[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$/i,
      requiredFields: ['city', 'postalCode'],
    },
    US: {
      postalCodePattern: /^\d{5}(-\d{4})?$/,
      requiredFields: ['city', 'postalCode', 'region'],
    },
    CA: {
      postalCodePattern: /^[A-Z]\d[A-Z] ?\d[A-Z]\d$/i,
      requiredFields: ['city', 'postalCode', 'region'],
    },
    KR: {
      postalCodePattern: /^\d{5}$/,
      requiredFields: ['city'],
    },
    JP: {
      postalCodePattern: /^\d{3}-?\d{4}$/,
      requiredFields: ['postalCode'],
    },
    IN: {
      postalCodePattern: /^\d{6}$/,
      requiredFields: ['city', 'postalCode', 'region'],
    },
    BR: {
      postalCodePattern: /^\d{5}-?\d{3}$/,
      requiredFields: ['city', 'postalCode', 'region'],
    },
    SG: {
      postalCodePattern: /^\d{6}$/,
      requiredFields: ['postalCode'],
    },
    AU: {
      postalCodePattern: /^\d{4}$/,
      requiredFields: ['city', 'postalCode', 'region'],
    },
    AE: {
      requiredFields: ['city'],
    },
    MX: {
      postalCodePattern: /^\d{5}$/,
      requiredFields: ['city', 'postalCode', 'region'],
    },
    // EA countries — tolerant, post codes rarely used
    TZ: { requiredFields: ['city'] },
    KE: { requiredFields: ['city'] },
    UG: { requiredFields: ['city'] },
    NG: { requiredFields: ['city', 'region'] },
    ZA: { postalCodePattern: /^\d{4}$/, requiredFields: ['city', 'postalCode'] },
  });

function splitLines(input: string): string[] {
  return input
    .split(/[\n,]/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function firstPostalMatch(
  lines: readonly string[],
  pattern: RegExp | undefined
): string | undefined {
  if (!pattern) return undefined;
  for (const line of lines) {
    const tokens = line.split(/\s+/).filter(Boolean);
    // Try single tokens first (fast path).
    for (const t of tokens) {
      if (pattern.test(t)) return t;
    }
    // Try the full line next (matches UK "SW1A 1AA" when the line IS the postcode).
    if (pattern.test(line)) return line;
    // Try consecutive pairs — some postal codes carry an internal space.
    for (let i = 0; i < tokens.length - 1; i++) {
      const pair = `${tokens[i]} ${tokens[i + 1]}`;
      if (pattern.test(pair)) return pair;
    }
  }
  return undefined;
}

export function validateAddress(
  raw: string,
  countryCode: string
): StructuredAddress {
  if (!raw || raw.trim().length === 0) {
    return {
      rawInput: raw ?? '',
      status: 'invalid',
      note: 'Address is empty.',
    };
  }
  const iso = countryCode.toUpperCase();
  const rule = COUNTRY_RULES[iso];
  const lines = splitLines(raw);

  if (lines.length === 0) {
    return { rawInput: raw, status: 'invalid', note: 'Address has no lines.' };
  }

  // Heuristic layout:
  //   line 0            → street
  //   last line         → city / region / postal code mix
  //   countryCode param → countryCode
  const street = lines[0];
  const tailLine = lines[lines.length - 1] ?? '';
  const tailTokens = tailLine.split(/\s+/);
  const postalCode = firstPostalMatch(lines, rule?.postalCodePattern);

  // Strip postal code from tail to guess city/region.
  const tailWithoutPostal = postalCode
    ? tailLine.replace(postalCode, '').trim()
    : tailLine;
  const tailParts = tailWithoutPostal.split(/\s+/).filter(Boolean);
  // Region heuristic — US-style 2-letter code at end of tail.
  const region =
    tailParts.length >= 2 && /^[A-Z]{2,3}$/.test(tailParts[tailParts.length - 1] ?? '')
      ? tailParts[tailParts.length - 1]
      : undefined;
  const city =
    tailParts.length > 0
      ? (region ? tailParts.slice(0, -1).join(' ') : tailParts.join(' '))
      : undefined;

  const buildAddress = (
    status: AddressStatus,
    extras: Partial<StructuredAddress> = {}
  ): StructuredAddress => {
    const obj: Record<string, unknown> = {
      rawInput: raw,
      status,
      countryCode: iso,
    };
    if (street) obj.street = street;
    if (city) obj.city = city;
    if (postalCode) obj.postalCode = postalCode;
    if (region) obj.region = region;
    return { ...(obj as unknown as StructuredAddress), ...extras };
  };

  if (!rule) {
    return buildAddress('unverified', {
      note: `No address rule registered for ${iso}; preserved as-is.`,
    });
  }

  const missing: string[] = [];
  for (const field of rule.requiredFields) {
    if (field === 'city' && !city) missing.push('city');
    if (field === 'postalCode' && !postalCode) missing.push('postalCode');
    if (field === 'region' && !region) missing.push('region');
  }

  // When postal-code pattern exists but didn't match any token, flag invalid.
  if (rule.postalCodePattern && !postalCode) missing.push('postalCode-format');

  if (missing.length > 0) {
    return buildAddress('invalid', {
      missingFields: Object.freeze(missing),
      note: `Address missing required fields for ${iso}: ${missing.join(', ')}.`,
    });
  }

  // Use tailTokens to avoid unused-var lint.
  void tailTokens;

  return buildAddress('valid');
}
