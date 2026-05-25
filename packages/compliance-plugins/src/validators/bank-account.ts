/**
 * Universal bank-account validator — IBAN (EU), ABA (US), SWIFT BIC.
 *
 * - IBAN uses the ISO 13616 mod-97 checksum (well-known algorithm).
 * - ABA routing checks 9-digit checksum (Fed's weighted sum).
 * - BIC is 8 or 11 chars, alpha-numeric with fixed position constraints.
 * - Anything else is accepted as `validation-unavailable` + stored raw.
 */

export type BankAccountStatus = 'valid' | 'invalid' | 'validation-unavailable';

export interface BankAccountResult {
  readonly status: BankAccountStatus;
  readonly ruleId?: string;
  readonly note?: string;
  readonly normalized?: string;
}

/** ISO 13616 mod-97. Returns `true` iff the IBAN is valid. */
export function ibanValid(raw: string): boolean {
  const cleaned = raw.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(cleaned)) return false;
  const rearranged = cleaned.slice(4) + cleaned.slice(0, 4);
  // Convert letters → numeric (A=10 .. Z=35).
  let expanded = '';
  for (const ch of rearranged) {
    if (/[A-Z]/.test(ch)) {
      expanded += (ch.charCodeAt(0) - 55).toString();
    } else {
      expanded += ch;
    }
  }
  // mod-97 using chunking to avoid overflow.
  let remainder = 0;
  for (let i = 0; i < expanded.length; i += 7) {
    const chunk = remainder.toString() + expanded.slice(i, i + 7);
    remainder = Number(chunk) % 97;
  }
  return remainder === 1;
}

/** US ABA 9-digit routing check. */
export function abaValid(raw: string): boolean {
  const digits = raw.replace(/\D+/g, '');
  if (digits.length !== 9) return false;
  const weights = [3, 7, 1, 3, 7, 1, 3, 7, 1];
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += Number(digits[i]) * (weights[i] ?? 0);
  }
  return sum % 10 === 0;
}

/** SWIFT BIC — 4 letters (bank) + 2 letters (country) + 2 chars (location)
 * + optional 3 chars (branch). */
export function bicValid(raw: string): boolean {
  const cleaned = raw.replace(/\s+/g, '').toUpperCase();
  return /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(cleaned);
}

/** Shared entrypoint — sniffs the format. */
export function validateBankAccount(
  raw: string,
  countryHint?: string
): BankAccountResult {
  if (!raw || raw.trim().length === 0) {
    return { status: 'invalid', note: 'Bank account is empty.' };
  }
  const trimmed = raw.trim();
  const cleaned = trimmed.replace(/\s+/g, '').toUpperCase();

  // IBAN — matched when it starts with 2 letters + 2 digits.
  if (/^[A-Z]{2}\d{2}/.test(cleaned)) {
    if (ibanValid(cleaned)) {
      return {
        status: 'valid',
        ruleId: 'iban',
        normalized: cleaned,
        note: `Valid IBAN (country ${cleaned.slice(0, 2)}).`,
      };
    }
    return {
      status: 'invalid',
      ruleId: 'iban',
      note: 'IBAN failed mod-97 checksum.',
    };
  }

  // BIC — purely alpha/numeric, 8 or 11 chars.
  if (bicValid(cleaned)) {
    return {
      status: 'valid',
      ruleId: 'bic',
      normalized: cleaned,
      note: 'Valid SWIFT BIC.',
    };
  }

  // ABA — 9 digits, common for US-hinted inputs.
  if (/^\d{9}$/.test(trimmed.replace(/\D+/g, ''))) {
    if (abaValid(trimmed)) {
      return {
        status: 'valid',
        ruleId: 'aba',
        normalized: trimmed.replace(/\D+/g, ''),
        note: 'Valid US ABA routing number.',
      };
    }
    return {
      status: 'invalid',
      ruleId: 'aba',
      note: 'ABA failed 9-digit checksum.',
    };
  }

  return {
    status: 'validation-unavailable',
    note: `No format rule matched for "${countryHint ?? 'unknown'}" — stored raw.`,
    normalized: trimmed,
  };
}
