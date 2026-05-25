/**
 * Kenyan tax / business identifier validators.
 *
 * KRA PIN: Personal Identification Number issued by the Kenya Revenue
 * Authority. Format: `[A-Z]\d{9}[A-Z]` — e.g. `A123456789B`. Required
 * for landlords to file Monthly Rental Income (MRI) returns.
 *
 * BRN: Business Registration Number issued by the Registrar of
 * Companies (eCitizen / BRS). Formats vary by entity type:
 *   - Company:      CPR/2019/123456 or PVT-ABC1234
 *   - Business name: BN/2019/123456
 *   - NGO:          IP/2019/123
 * We accept the common shapes and normalize by trimming + uppercasing.
 */

import { z } from 'zod';

// KRA PIN: letter + 9 digits + letter, 11 chars total.
// Uppercase letters only; we normalize from mixed-case at input.
export const KRA_PIN_REGEX = /^[A-Z]\d{9}[A-Z]$/;

export function isValidKraPin(pin: string): boolean {
  return KRA_PIN_REGEX.test(pin.trim().toUpperCase());
}

export const KraPinSchema = z
  .string()
  .trim()
  .min(11, 'KRA PIN must be 11 characters')
  .max(11, 'KRA PIN must be 11 characters')
  .transform((v) => v.toUpperCase())
  .refine((v) => KRA_PIN_REGEX.test(v), {
    message: 'KRA PIN must match format A000000000B (letter, 9 digits, letter)',
  });

// BRN accepts the common shapes above. We're permissive about spacing
// and separators since the official format varies by issuance era.
// Normalization strips whitespace and uppercases.
const BRN_MIN_LEN = 5;
const BRN_MAX_LEN = 32;
const BRN_ALLOWED_CHARS = /^[A-Z0-9/\-.]+$/;

export function isValidBrn(brn: string): boolean {
  const normalized = brn.trim().toUpperCase();
  if (normalized.length < BRN_MIN_LEN || normalized.length > BRN_MAX_LEN) return false;
  return BRN_ALLOWED_CHARS.test(normalized);
}

export const BrnSchema = z
  .string()
  .trim()
  .min(BRN_MIN_LEN, `BRN must be at least ${BRN_MIN_LEN} characters`)
  .max(BRN_MAX_LEN, `BRN must be at most ${BRN_MAX_LEN} characters`)
  .transform((v) => v.toUpperCase().replace(/\s+/g, ''))
  .refine((v) => BRN_ALLOWED_CHARS.test(v), {
    message: 'BRN may only contain letters, digits, slashes, dashes, and dots',
  });

/**
 * Combined Kenyan compliance fields captured at tenant onboarding.
 * Individual landlords supply only the KRA PIN; registered companies
 * supply both PIN and BRN.
 */
export const KenyanComplianceIdentifiersSchema = z.object({
  kraPin: KraPinSchema,
  businessRegistrationNumber: BrnSchema.optional(),
  entityType: z.enum(['individual', 'company', 'partnership', 'ngo']).default('individual'),
}).refine(
  (v) => v.entityType === 'individual' || v.businessRegistrationNumber !== undefined,
  { message: 'BRN is required for company/partnership/ngo entities', path: ['businessRegistrationNumber'] }
);

export type KenyanComplianceIdentifiers = z.infer<typeof KenyanComplianceIdentifiersSchema>;
