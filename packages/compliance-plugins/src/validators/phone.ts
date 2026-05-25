/**
 * Universal phone validator.
 *
 * Accepts free-form input + optional ISO-3166-1 country hint, returns a
 * normalized E.164 value (with leading '+') OR a structured invalid result.
 *
 * Design choice — we deliberately avoid a runtime dependency on
 * `libphonenumber-js` here. The registry's `buildPhoneNormalizer` already
 * handles the 18 country prefixes the platform supports, and `google-
 * libphonenumber` is available in the workspace for heavy-weight parsing
 * when callers opt into it. This validator provides a format-only check
 * that's 100% pure and portable.
 *
 * Contract:
 *   - Never throws. Invalid input returns `status: 'invalid'`.
 *   - `countryHint` is consulted ONLY when input has no '+' prefix.
 *   - Output `e164` is present iff `status === 'valid'`.
 */

export type PhoneValidationStatus =
  | 'valid'
  | 'invalid'
  | 'needs-country-hint'
  // Round-3 audit H20 — surfaced when the input had `+` but the
  // calling-code prefix was not recognised. Distinct from 'invalid'
  // (where the input is structurally broken) and 'needs-country-hint'
  // (where the input has no `+` at all). Callers should retry with an
  // ISO-3166-1 alpha-2 country code.
  | 'validation-unavailable';

export interface PhoneValidationResult {
  readonly status: PhoneValidationStatus;
  /** E.164 representation, only set when status === 'valid'. */
  readonly e164?: string;
  /** Detected calling-code dial prefix (no '+'), only when valid. */
  readonly callingCode?: string;
  /** ISO-3166-1 alpha-2 when unambiguously resolvable. */
  readonly countryCode?: string;
  /** Human-readable diagnostic when not valid. */
  readonly note?: string;
}

/**
 * Known calling-code → ISO-3166 map. Enough for the 18 countries the
 * platform ships + common fallbacks. Keys are dialling prefixes sans '+'.
 * Ambiguous prefixes (e.g. '1' = US/CA/JM) map to `null` so callers can
 * provide a hint.
 */
const CALLING_CODE_TO_ISO: Readonly<Record<string, string | null>> =
  Object.freeze({
    '1': null, // NANP — US / CA / JM / ...
    '27': 'ZA',
    '33': 'FR',
    '44': 'GB',
    '49': 'DE',
    '52': 'MX',
    '55': 'BR',
    '61': 'AU',
    '65': 'SG',
    '81': 'JP',
    '82': 'KR',
    '91': 'IN',
    '234': 'NG',
    '254': 'KE',
    '255': 'TZ',
    '256': 'UG',
    '971': 'AE',
  });

const ISO_TO_CALLING_CODE: Readonly<Record<string, string>> = Object.freeze({
  US: '1',
  CA: '1',
  ZA: '27',
  FR: '33',
  GB: '44',
  DE: '49',
  MX: '52',
  BR: '55',
  AU: '61',
  SG: '65',
  JP: '81',
  KR: '82',
  IN: '91',
  NG: '234',
  KE: '254',
  TZ: '255',
  UG: '256',
  AE: '971',
});

/** E.164 total length: 1-15 digits after the '+'. */
const E164_DIGIT_MIN = 7;
const E164_DIGIT_MAX = 15;

/**
 * Strip everything except digits. Keeps a leading '+' flag separate so
 * we can tell when the caller already supplied a full international form.
 */
function stripToDigits(raw: string): { digits: string; hadPlus: boolean } {
  const trimmed = raw.trim();
  const hadPlus = trimmed.startsWith('+');
  return { digits: trimmed.replace(/\D+/g, ''), hadPlus };
}

function isoForCallingCode(prefix: string): string | undefined {
  const iso = CALLING_CODE_TO_ISO[prefix];
  if (iso === undefined) return undefined;
  return iso ?? undefined;
}

/** Best-effort split of a raw digit string into (callingCode, subscriber). */
function detectCallingCode(
  digits: string,
  hint?: string
): { callingCode: string; subscriber: string } | null {
  // Try 3 → 2 → 1 digit prefixes.
  for (const len of [3, 2, 1]) {
    const candidate = digits.slice(0, len);
    if (CALLING_CODE_TO_ISO[candidate] !== undefined) {
      return { callingCode: candidate, subscriber: digits.slice(len) };
    }
  }
  if (hint) {
    const hintCode = ISO_TO_CALLING_CODE[hint.toUpperCase()];
    if (hintCode && digits.startsWith(hintCode)) {
      return {
        callingCode: hintCode,
        subscriber: digits.slice(hintCode.length),
      };
    }
  }
  return null;
}

export function validatePhone(
  raw: string,
  countryHint?: string
): PhoneValidationResult {
  if (!raw || raw.trim().length === 0) {
    return { status: 'invalid', note: 'Phone input is empty.' };
  }
  const { digits, hadPlus } = stripToDigits(raw);
  if (digits.length < E164_DIGIT_MIN) {
    return { status: 'invalid', note: 'Phone has too few digits for E.164.' };
  }
  if (digits.length > E164_DIGIT_MAX) {
    return { status: 'invalid', note: 'Phone exceeds 15 digits (E.164 cap).' };
  }

  // International form — already includes calling code.
  if (hadPlus) {
    const detected = detectCallingCode(digits, countryHint);
    if (!detected) {
      // Round-3 audit H20 fix — the previous branch returned
      // `status: 'valid'` for an unrecognised calling code. That
      // contradicted the docstring (which said unknown calling codes
      // should trigger 'needs-country-hint') and let downstream
      // callers ship phones that no SMS/WhatsApp provider could
      // actually deliver. Surfacing 'validation-unavailable' lets
      // callers retry with a different hint instead of silently
      // burning provider credits on a 400.
      return {
        status: 'validation-unavailable',
        note: 'Calling-code prefix not recognised. Provide a country hint or use an ISO-3166-1 alpha-2 code.',
      };
    }
    const resolvedIso =
      isoForCallingCode(detected.callingCode) ?? countryHint;
    const base = {
      status: 'valid' as const,
      e164: `+${digits}`,
      callingCode: detected.callingCode,
    };
    return resolvedIso ? { ...base, countryCode: resolvedIso } : base;
  }

  // Local form + hint — prepend the hint's calling code.
  if (countryHint) {
    const hintCode = ISO_TO_CALLING_CODE[countryHint.toUpperCase()];
    if (!hintCode) {
      return {
        status: 'needs-country-hint',
        note: `Unknown country hint "${countryHint}" — no calling code mapped.`,
      };
    }
    // Allow trunk prefix '0' stripping for hints that commonly use it.
    let subscriber = digits;
    if (digits.startsWith('0')) subscriber = digits.slice(1);
    const candidate = `${hintCode}${subscriber}`;
    if (candidate.length < E164_DIGIT_MIN) {
      return {
        status: 'invalid',
        note: 'Digits after country prefix too short for E.164.',
      };
    }
    return {
      status: 'valid',
      e164: `+${candidate}`,
      callingCode: hintCode,
      countryCode: countryHint.toUpperCase(),
    };
  }

  // Local form, no hint → caller must supply one.
  return {
    status: 'needs-country-hint',
    note: 'Provide a countryHint — raw digits have no calling code.',
  };
}

/** Build a country-pinned validator — convenience wrapper. */
export function buildPhoneValidatorForCountry(countryCode: string) {
  return (raw: string) => validatePhone(raw, countryCode);
}
