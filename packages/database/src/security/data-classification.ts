/**
 * Per-FIELD data-classification registry.
 *
 * BOSS today classifies POLICIES (retention) but not FIELDS. LITFIN's
 * `lib/security/data-classification.ts` assigns RESTRICTED /
 * CONFIDENTIAL / INTERNAL / PUBLIC + encrypt + maskType to every
 * personal-data column so the API/UI layers can consult the registry
 * before rendering. This module ports that pattern to BOSS schemas.
 *
 * Tailored for property-management + TZ/KE PII: NIDA, KRA PIN,
 * M-Pesa numbers, GEPG payer details, lease tenancy data.
 *
 * Sources for column names: the Drizzle schemas under
 *   packages/database/src/schemas/{customer,lease,payment,communications,
 *   gepg,voice-turns,feedback-complaints,documents,inspections,
 *   marketplace,tenant-predictions}.schema.ts
 *
 * NEVER mutate the registry — entries are exported as a frozen tuple so
 * callers cannot accidentally rewrite the security stance at runtime.
 */

/** Sensitivity tiers (mirrors LITFIN's enum). */
export type ClassificationLevel =
  | 'RESTRICTED'
  | 'CONFIDENTIAL'
  | 'INTERNAL'
  | 'PUBLIC';

/** Masking strategies — picked to be display-renderable without re-decryption. */
export type MaskType =
  | 'phone'
  | 'email'
  | 'id'
  | 'address'
  | 'name'
  | 'financial'
  | 'none';

/** Retention windows. `permanent` = legal hold / audit immutability. */
export type RetentionWindow = '90d' | '365d' | '7y' | 'permanent';

/** Per-column classification record. Immutable by construction. */
export interface FieldClassification {
  readonly table: string;
  readonly column: string;
  readonly level: ClassificationLevel;
  readonly encryptAtRest: boolean;
  readonly maskType: MaskType;
  readonly retention: RetentionWindow;
  /** Free-form rationale — useful for audit reviewers. */
  readonly note?: string;
}

// ─────────────────────────────────────────────────────────────────────
// Registry. Order is informational; lookup goes through the index map.
// ─────────────────────────────────────────────────────────────────────

const ENTRIES: ReadonlyArray<FieldClassification> = Object.freeze([
  // ── customers ────────────────────────────────────────────────────────
  {
    table: 'customers',
    column: 'email',
    level: 'CONFIDENTIAL',
    encryptAtRest: true,
    maskType: 'email',
    retention: '7y',
    note: 'PII direct identifier — GDPR Art.4(1), PDPA s.2',
  },
  {
    table: 'customers',
    column: 'phone',
    level: 'CONFIDENTIAL',
    encryptAtRest: true,
    maskType: 'phone',
    retention: '7y',
    note: 'M-Pesa / Tigo Pesa lookup vector — high-value PII in TZ/KE',
  },
  {
    table: 'customers',
    column: 'alternate_phone',
    level: 'CONFIDENTIAL',
    encryptAtRest: true,
    maskType: 'phone',
    retention: '7y',
  },
  {
    table: 'customers',
    column: 'first_name',
    level: 'CONFIDENTIAL',
    encryptAtRest: false,
    maskType: 'name',
    retention: '7y',
  },
  {
    table: 'customers',
    column: 'last_name',
    level: 'CONFIDENTIAL',
    encryptAtRest: false,
    maskType: 'name',
    retention: '7y',
  },
  {
    table: 'customers',
    column: 'middle_name',
    level: 'CONFIDENTIAL',
    encryptAtRest: false,
    maskType: 'name',
    retention: '7y',
  },
  {
    table: 'customers',
    column: 'date_of_birth',
    level: 'RESTRICTED',
    encryptAtRest: true,
    maskType: 'id',
    retention: '7y',
    note: 'Special-category-adjacent: re-identification risk when joined',
  },
  {
    table: 'customers',
    column: 'id_document_number',
    level: 'RESTRICTED',
    encryptAtRest: true,
    maskType: 'id',
    retention: '7y',
    note: 'NIDA (TZ) / National ID (KE) / Passport — statutory PII',
  },
  {
    table: 'customers',
    column: 'id_document_front_url',
    level: 'RESTRICTED',
    encryptAtRest: true,
    maskType: 'none',
    retention: '7y',
    note: 'Signed-URL only; underlying object lives in private bucket',
  },
  {
    table: 'customers',
    column: 'id_document_back_url',
    level: 'RESTRICTED',
    encryptAtRest: true,
    maskType: 'none',
    retention: '7y',
  },
  {
    table: 'customers',
    column: 'kra_pin',
    level: 'RESTRICTED',
    encryptAtRest: true,
    maskType: 'id',
    retention: '7y',
    note: 'KE tax ID — KRA Act s.5; treat as RESTRICTED even when absent',
  },
  {
    table: 'customers',
    column: 'tin_number',
    level: 'RESTRICTED',
    encryptAtRest: true,
    maskType: 'id',
    retention: '7y',
    note: 'TZ Taxpayer ID Number — TRA Act',
  },
  {
    table: 'customers',
    column: 'monthly_income',
    level: 'CONFIDENTIAL',
    encryptAtRest: false,
    maskType: 'financial',
    retention: '7y',
  },
  {
    table: 'customers',
    column: 'occupation',
    level: 'INTERNAL',
    encryptAtRest: false,
    maskType: 'none',
    retention: '7y',
  },
  {
    table: 'customers',
    column: 'employer',
    level: 'INTERNAL',
    encryptAtRest: false,
    maskType: 'none',
    retention: '7y',
  },
  {
    table: 'customers',
    column: 'current_address_line1',
    level: 'CONFIDENTIAL',
    encryptAtRest: true,
    maskType: 'address',
    retention: '7y',
  },
  {
    table: 'customers',
    column: 'current_address_line2',
    level: 'CONFIDENTIAL',
    encryptAtRest: true,
    maskType: 'address',
    retention: '7y',
  },
  {
    table: 'customers',
    column: 'emergency_contact_phone',
    level: 'CONFIDENTIAL',
    encryptAtRest: true,
    maskType: 'phone',
    retention: '7y',
  },
  {
    table: 'customers',
    column: 'emergency_contact_email',
    level: 'CONFIDENTIAL',
    encryptAtRest: true,
    maskType: 'email',
    retention: '7y',
  },
  {
    table: 'customers',
    column: 'kyc_notes',
    level: 'RESTRICTED',
    encryptAtRest: true,
    maskType: 'none',
    retention: '7y',
    note: 'Free-text — may contain national IDs / financial details',
  },

  // ── users (operators / staff) ────────────────────────────────────────
  {
    table: 'users',
    column: 'email',
    level: 'CONFIDENTIAL',
    encryptAtRest: true,
    maskType: 'email',
    retention: '7y',
  },
  {
    table: 'users',
    column: 'phone',
    level: 'CONFIDENTIAL',
    encryptAtRest: true,
    maskType: 'phone',
    retention: '7y',
  },
  {
    table: 'users',
    column: 'password_hash',
    level: 'RESTRICTED',
    encryptAtRest: true,
    maskType: 'none',
    retention: '7y',
    note: 'Argon2/bcrypt — never log, never expose in DSAR',
  },
  {
    table: 'users',
    column: 'mfa_secret',
    level: 'RESTRICTED',
    encryptAtRest: true,
    maskType: 'none',
    retention: '7y',
  },

  // ── leases ───────────────────────────────────────────────────────────
  {
    table: 'leases',
    column: 'rent_amount',
    level: 'INTERNAL',
    encryptAtRest: false,
    maskType: 'financial',
    retention: '7y',
  },
  {
    table: 'leases',
    column: 'security_deposit_amount',
    level: 'INTERNAL',
    encryptAtRest: false,
    maskType: 'financial',
    retention: '7y',
  },
  {
    table: 'leases',
    column: 'tenant_signature_url',
    level: 'RESTRICTED',
    encryptAtRest: true,
    maskType: 'none',
    retention: '7y',
    note: 'Biometric-adjacent — handwriting can identify',
  },

  // ── payments ─────────────────────────────────────────────────────────
  {
    table: 'payments',
    column: 'amount',
    level: 'CONFIDENTIAL',
    encryptAtRest: false,
    maskType: 'financial',
    retention: '7y',
  },
  {
    table: 'payments',
    column: 'mpesa_phone',
    level: 'RESTRICTED',
    encryptAtRest: true,
    maskType: 'phone',
    retention: '7y',
    note: 'M-Pesa identifier — Safaricom + CBK regulated PII',
  },
  {
    table: 'payments',
    column: 'mpesa_transaction_id',
    level: 'CONFIDENTIAL',
    encryptAtRest: true,
    maskType: 'id',
    retention: '7y',
  },
  {
    table: 'payments',
    column: 'bank_reference',
    level: 'CONFIDENTIAL',
    encryptAtRest: true,
    maskType: 'id',
    retention: '7y',
  },

  // ── invoices ─────────────────────────────────────────────────────────
  {
    table: 'invoices',
    column: 'total_amount',
    level: 'CONFIDENTIAL',
    encryptAtRest: false,
    maskType: 'financial',
    retention: '7y',
  },
  {
    table: 'invoices',
    column: 'customer_notes',
    level: 'CONFIDENTIAL',
    encryptAtRest: false,
    maskType: 'none',
    retention: '7y',
  },

  // ── gepg_transactions (TZ statutory rail) ────────────────────────────
  {
    table: 'gepg_transactions',
    column: 'payer_name',
    level: 'CONFIDENTIAL',
    encryptAtRest: false,
    maskType: 'name',
    retention: '7y',
  },
  {
    table: 'gepg_transactions',
    column: 'payer_phone',
    level: 'CONFIDENTIAL',
    encryptAtRest: true,
    maskType: 'phone',
    retention: '7y',
  },
  {
    table: 'gepg_transactions',
    column: 'payer_email',
    level: 'CONFIDENTIAL',
    encryptAtRest: true,
    maskType: 'email',
    retention: '7y',
  },
  {
    table: 'gepg_transactions',
    column: 'control_number',
    level: 'INTERNAL',
    encryptAtRest: false,
    maskType: 'id',
    retention: '7y',
    note: 'GEPG control number — non-PII identifier but treated as INTERNAL',
  },

  // ── communications (messages / templates rendered) ──────────────────
  {
    table: 'messages',
    column: 'body',
    level: 'CONFIDENTIAL',
    encryptAtRest: true,
    maskType: 'none',
    retention: '365d',
    note: 'Outbound WhatsApp/SMS/email — may contain PII from variables',
  },
  {
    table: 'messages',
    column: 'recipient_phone',
    level: 'CONFIDENTIAL',
    encryptAtRest: true,
    maskType: 'phone',
    retention: '365d',
  },
  {
    table: 'messages',
    column: 'recipient_email',
    level: 'CONFIDENTIAL',
    encryptAtRest: true,
    maskType: 'email',
    retention: '365d',
  },

  // ── voice_turns ──────────────────────────────────────────────────────
  {
    table: 'voice_turns',
    column: 'transcript',
    level: 'RESTRICTED',
    encryptAtRest: true,
    maskType: 'none',
    retention: '90d',
    note: 'Voice transcripts — biometric proxy; short retention',
  },
  {
    table: 'voice_turns',
    column: 'audio_url',
    level: 'RESTRICTED',
    encryptAtRest: true,
    maskType: 'none',
    retention: '90d',
  },

  // ── feedback / complaints ────────────────────────────────────────────
  {
    table: 'feedback',
    column: 'body',
    level: 'CONFIDENTIAL',
    encryptAtRest: false,
    maskType: 'none',
    retention: '365d',
  },
  {
    table: 'feedback',
    column: 'submitted_by_email',
    level: 'CONFIDENTIAL',
    encryptAtRest: true,
    maskType: 'email',
    retention: '365d',
  },

  // ── tenant_predictions (PII-adjacent via inference) ─────────────────
  {
    table: 'tenant_predictions',
    column: 'feature_payload',
    level: 'CONFIDENTIAL',
    encryptAtRest: false,
    maskType: 'none',
    retention: '365d',
    note: 'ML features — re-identification possible at high cardinality',
  },

  // ── documents (KYC scans + lease PDFs) ───────────────────────────────
  {
    table: 'documents',
    column: 'storage_url',
    level: 'RESTRICTED',
    encryptAtRest: true,
    maskType: 'none',
    retention: '7y',
  },
  {
    table: 'documents',
    column: 'extracted_text',
    level: 'RESTRICTED',
    encryptAtRest: true,
    maskType: 'none',
    retention: '7y',
    note: 'OCR output — almost always PII-heavy',
  },

  // ── inspections ──────────────────────────────────────────────────────
  {
    table: 'inspections',
    column: 'photos',
    level: 'CONFIDENTIAL',
    encryptAtRest: true,
    maskType: 'none',
    retention: '7y',
    note: 'Property photos may capture occupants — treat as PII-adjacent',
  },

  // ── marketplace_listings ─────────────────────────────────────────────
  {
    table: 'marketplace_listings',
    column: 'lister_phone',
    level: 'CONFIDENTIAL',
    encryptAtRest: true,
    maskType: 'phone',
    retention: '365d',
  },
  {
    table: 'marketplace_listings',
    column: 'lister_email',
    level: 'CONFIDENTIAL',
    encryptAtRest: true,
    maskType: 'email',
    retention: '365d',
  },

  // ── audit (immutable) ────────────────────────────────────────────────
  {
    table: 'audit_events',
    column: 'actor_email',
    level: 'INTERNAL',
    encryptAtRest: false,
    maskType: 'email',
    retention: 'permanent',
    note: 'Audit trail — never expunged; pseudonymise on RTBF',
  },
]);

// ─────────────────────────────────────────────────────────────────────
// Index for O(1) lookup. Frozen.
// ─────────────────────────────────────────────────────────────────────

const INDEX: ReadonlyMap<string, FieldClassification> = (() => {
  const m = new Map<string, FieldClassification>();
  for (const e of ENTRIES) {
    m.set(key(e.table, e.column), e);
  }
  return m;
})();

function key(table: string, column: string): string {
  return `${table.toLowerCase()}::${column.toLowerCase()}`;
}

/**
 * Look up a column's classification. Returns `null` when the column is
 * not registered — callers should treat unregistered fields as INTERNAL
 * by default (fail-closed at the consumer site, not here).
 */
export function classify(
  table: string,
  column: string,
): FieldClassification | null {
  if (!table || !column) return null;
  return INDEX.get(key(table, column)) ?? null;
}

/** Return the full registry (frozen). Useful for compliance reporting. */
export function listClassifications(): ReadonlyArray<FieldClassification> {
  return ENTRIES;
}

/** Return only entries for one table. Empty array when unknown. */
export function classificationsForTable(
  table: string,
): ReadonlyArray<FieldClassification> {
  if (!table) return [];
  const t = table.toLowerCase();
  return ENTRIES.filter((e) => e.table.toLowerCase() === t);
}

// ─────────────────────────────────────────────────────────────────────
// Masking. Pure — no side effects, no I/O. Values that are nullish are
// passed through unchanged so callers can map() over result sets safely.
// ─────────────────────────────────────────────────────────────────────

/**
 * Render a value masked per the classification's `maskType`. PUBLIC
 * classifications return the value as-is. Non-string values are coerced
 * to string before masking; numbers and Dates render through `String()`.
 */
export function maskValue(
  value: unknown,
  classification: Pick<FieldClassification, 'level' | 'maskType'>,
): string | null {
  if (value === null || value === undefined) return null;
  if (classification.level === 'PUBLIC') return String(value);
  const s = String(value);
  switch (classification.maskType) {
    case 'phone':
      return maskPhone(s);
    case 'email':
      return maskEmail(s);
    case 'id':
      return maskId(s);
    case 'address':
      return maskAddress(s);
    case 'name':
      return maskName(s);
    case 'financial':
      return maskFinancial(s);
    case 'none':
      // No display masking, but RESTRICTED/CONFIDENTIAL still hide entirely.
      return classification.level === 'RESTRICTED' ? '[RESTRICTED]' : s;
    default:
      // Exhaustive guard — TypeScript will warn if a new mask is added.
      return '[CLASSIFIED]';
  }
}

// ─────────────────────────────────────────────────────────────────────
// Mask helpers. Deliberately defensive — never throw, never log.
// ─────────────────────────────────────────────────────────────────────

function maskPhone(s: string): string {
  const digits = s.replace(/\D+/g, '');
  if (digits.length <= 4) return '****';
  return `${digits.slice(0, 2)}**${digits.slice(-2)}`;
}

function maskEmail(s: string): string {
  const at = s.indexOf('@');
  if (at <= 0) return '****';
  const local = s.slice(0, at);
  const domain = s.slice(at);
  if (local.length <= 1) return `*${domain}`;
  if (local.length <= 3) return `${local[0]}**${domain}`;
  return `${local[0]}***${local[local.length - 1]}${domain}`;
}

function maskId(s: string): string {
  const compact = s.replace(/\s+/g, '');
  if (compact.length <= 4) return '****';
  return `****${compact.slice(-4)}`;
}

function maskAddress(s: string): string {
  // Keep first token (often the city/region) so listings can group; mask the rest.
  const trimmed = s.trim();
  if (trimmed.length <= 4) return '****';
  const firstSpace = trimmed.indexOf(' ');
  if (firstSpace <= 0) return `${trimmed.slice(0, 2)}***`;
  return `${trimmed.slice(0, firstSpace)} ****`;
}

function maskName(s: string): string {
  const parts = s.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '****';
  return parts
    .map((p) => (p.length <= 1 ? p : `${p[0]}${'*'.repeat(Math.max(2, p.length - 1))}`))
    .join(' ');
}

function maskFinancial(s: string): string {
  // Preserve the magnitude bucket so dashboards still render usefully.
  const n = Number(s);
  if (!Number.isFinite(n)) return '****';
  const abs = Math.abs(n);
  if (abs < 1_000) return '<1K';
  if (abs < 10_000) return '~1–10K';
  if (abs < 100_000) return '~10–100K';
  if (abs < 1_000_000) return '~100K–1M';
  return '>1M';
}
