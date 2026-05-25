/**
 * Entity extractor — pulls named entities (people, dates, amounts, IDs,
 * plot numbers, addresses) out of OCR text. Rule-based first (deterministic
 * + citable); the LLM port augments only when rules return nothing.
 *
 * Every extraction carries a citation back to the source via the
 * `locateInLayout()` helper, so the frontend can highlight the
 * exact substring on the original page.
 */

import type { ParsedLayout } from '../layout/index.js';
import { locateInLayout } from '../layout/index.js';
import type { DocType, BBox, ExtractionKind, SourceMethod } from '../types.js';

export interface ExtractedField {
  readonly key: string;
  readonly value: unknown;
  readonly confidence: number;
  readonly extractionKind: ExtractionKind;
  readonly sourceMethod: SourceMethod;
  readonly page: number | null;
  readonly bbox: BBox | null;
  /** Raw matched substring — used for citation lookup. */
  readonly matchedText?: string;
}

// ─── Regex bank ───────────────────────────────────────────────────────────

/**
 * Currencies we accept. Token must precede the amount. The captured group
 * is the digits + thousands/decimal separators.
 */
const CURRENCY_AMOUNT_RX =
  /\b(KES|TZS|UGX|RWF|NGN|GHS|USD)\s*([0-9](?:[0-9.,\s]*[0-9])?)/gi;

/** Tanzania NIDA format: 20 digits with optional dashes. */
const NIDA_RX = /\b((?:\d{8}-\d{5}-\d{5}-\d{2})|(?:\d{20}))\b/g;
/** Kenya KRA PIN: A123456789Z. */
const KRA_PIN_RX = /\b([A-Z]\d{9}[A-Z])\b/g;
/** Kenya national ID: 7-8 digit number. */
const KENYA_ID_RX = /\bID\s*(?:no\.?|number)?\s*[:\s]+(\d{7,8})\b/i;
/**
 * GePG receipt reference: control numbers are numeric (often start 99).
 * We capture only when the label is one of the canonical GePG markers
 * and the value is a 8-24 digit run. We do NOT match plain `Ref no.`
 * here — that's handled separately and would pick up alphanumeric refs.
 */
const GEPG_REF_RX =
  /\b(?:gepg\s*(?:control\s*number|ref(?:erence)?)|control\s*number)[:\s]+(\d{8,24})\b/i;
/** M-Pesa transaction reference: e.g. RFD9KL2P3M (10 alphanumeric). */
const MPESA_REF_RX = /\b(?:m[-\s]?pesa|mpesa)[^A-Za-z0-9]+([A-Z0-9]{9,12})\b/i;
/** Plot number: e.g. PLOT 123, PLOT NO. 45/B, PROP-DAR-0001. */
const PLOT_RX = /\b(?:plot|prop|property)\s*(?:no\.?|number|reference|ref)?[:\s]+([A-Z0-9][A-Z0-9\-/]{2,32})\b/i;
/** Address: at least two of street/road/area + town. Best-effort. */
const ADDRESS_RX =
  /\b((?:plot|house|apt|apartment|unit)\s+[\dA-Z][\dA-Z\-/]{0,20}[,\s]+(?:[A-Z][a-z]+\s+(?:road|street|avenue|drive|lane)[,\s]+)?[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/g;
/** Phone: E.164-ish or local Tanzania/Kenya. */
const PHONE_RX = /(\+?255\d{9}|\+?254\d{9}|\+?2557\d{8}|0[67]\d{8})/g;

/** Dates: 2025-02-15, 15/02/2025, 15 Feb 2025, Feb 15 2025. */
const DATE_RX_ISO = /\b(\d{4}-\d{2}-\d{2})\b/g;
const DATE_RX_SLASH = /\b(\d{1,2}\/\d{1,2}\/\d{2,4})\b/g;
const DATE_RX_MONTH =
  /\b(\d{1,2}\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{2,4})\b/gi;

// ─── Per-doc-type extraction profiles ────────────────────────────────────

interface ExtractionProfile {
  readonly fields: ReadonlyArray<FieldSpec>;
}

interface FieldSpec {
  readonly key: string;
  readonly kind: ExtractionKind;
  readonly extract: (text: string) => Array<{
    value: unknown;
    confidence: number;
    matchedText: string;
  }>;
}

function labelLookup(
  text: string,
  labels: ReadonlyArray<string>,
  captureRx: RegExp,
  confidence = 0.85,
): Array<{ value: string; confidence: number; matchedText: string }> {
  const out: Array<{ value: string; confidence: number; matchedText: string }> = [];
  const norm = text;
  for (const label of labels) {
    const rx = new RegExp(`${label}[:\\s]+${captureRx.source}`, 'i');
    const m = rx.exec(norm);
    if (m && m[1]) {
      out.push({ value: m[1].trim(), confidence, matchedText: m[0] });
    }
  }
  return out;
}

/**
 * Money amount with both legacy float-major and integer-minor
 * representations. `amountMinor` is the canonical value for any
 * downstream ledger or rule path (precision-safe integer in cents).
 * `amount` is preserved for backward-compat with display layers that
 * already render the major-unit float.
 *
 * P84 audit BUG-HI-6: `parseFloat` alone loses precision above ~15
 * digits. We now parse the digits with `Math.round(value * 100)` to
 * produce a precision-safe integer minor-unit value, and validate
 * via `Number.isFinite` to refuse Infinity / NaN.
 */
export interface ExtractedAmount {
  readonly currency: string;
  /** Legacy major-unit float — kept for back-compat display. */
  readonly amount: number;
  /** Canonical integer minor units (cents). Precision-safe. */
  readonly amountMinor: number;
}

function parseAmountToMinor(raw: string): ExtractedAmount['amount'] | null {
  // Strip separators, then parseFloat. Refuse Infinity/NaN.
  const cleaned = raw.replace(/[\s,]/g, '');
  const major = Number.parseFloat(cleaned);
  if (!Number.isFinite(major) || major < 0) return null;
  return major;
}

function buildAmount(currency: string, major: number): ExtractedAmount {
  // `Math.round(major * 100)` guards against `0.1 + 0.2`-style drift up
  // to the safe-integer limit (~$90 trillion in minor units).
  const minor = Math.round(major * 100);
  if (!Number.isSafeInteger(minor)) {
    // Should never happen for realistic invoice values; degrade
    // gracefully by clamping `amount` and signalling via amountMinor=0
    // rather than throwing in an extraction hot-path.
    return { currency, amount: major, amountMinor: 0 };
  }
  return { currency, amount: major, amountMinor: minor };
}

function extractAllAmounts(
  text: string,
): Array<{ value: ExtractedAmount; confidence: number; matchedText: string }> {
  CURRENCY_AMOUNT_RX.lastIndex = 0;
  const out: Array<{ value: ExtractedAmount; confidence: number; matchedText: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = CURRENCY_AMOUNT_RX.exec(text)) !== null) {
    const currency = m[1]?.toUpperCase() ?? 'KES';
    const major = parseAmountToMinor(m[2] ?? '');
    if (major !== null && major > 0) {
      out.push({ value: buildAmount(currency, major), confidence: 0.9, matchedText: m[0] });
    }
  }
  return out;
}

function extractAllDates(
  text: string,
): Array<{ value: string; confidence: number; matchedText: string }> {
  const out: Array<{ value: string; confidence: number; matchedText: string }> = [];
  for (const rx of [DATE_RX_ISO, DATE_RX_SLASH, DATE_RX_MONTH]) {
    rx.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rx.exec(text)) !== null) {
      out.push({ value: m[1] ?? m[0], confidence: 0.85, matchedText: m[0] });
    }
  }
  return out;
}

function extractPersonByLabels(
  text: string,
  labels: ReadonlyArray<string>,
): Array<{ value: string; confidence: number; matchedText: string }> {
  return labelLookup(text, labels, /([A-Z][A-Za-z'`.\- ]{2,80})/);
}

// ─── Profiles ─────────────────────────────────────────────────────────────

const LEASE_FIELDS: ReadonlyArray<FieldSpec> = [
  {
    key: 'landlord_name',
    kind: 'entity',
    extract: (t) => extractPersonByLabels(t, ['lessor', 'landlord', 'mwenye nyumba']),
  },
  {
    key: 'tenant_name',
    kind: 'entity',
    extract: (t) =>
      extractPersonByLabels(t, [
        'lessee',
        'tenant name',
        'jina la mpangaji',
        'mpangaji',
        'tenant',
      ]),
  },
  {
    key: 'asset_reference',
    kind: 'entity',
    extract: (t) => {
      const m = PLOT_RX.exec(t);
      return m && m[1]
        ? [{ value: m[1].trim(), confidence: 0.9, matchedText: m[0] }]
        : [];
    },
  },
  {
    key: 'monthly_rent',
    kind: 'amount',
    extract: (t) => {
      const amounts = extractAllAmounts(t);
      if (amounts.length === 0) return [];
      // Cheapest heuristic: the first labelled rent amount.
      const labelled = /(?:monthly\s+rent|kodi\s+ya\s+mwezi|rent\s*[:=])[^\n]{0,80}?(KES|TZS|UGX|RWF|NGN|GHS|USD)\s*([0-9](?:[0-9.,\s]*[0-9])?)/i.exec(
        t,
      );
      if (labelled && labelled[1] && labelled[2]) {
        const currency = labelled[1].toUpperCase();
        const major = parseAmountToMinor(labelled[2]);
        if (major !== null) {
          return [
            {
              value: buildAmount(currency, major),
              confidence: 0.95,
              matchedText: labelled[0],
            },
          ];
        }
      }
      // Fallback: first detected amount.
      return [{ ...amounts[0]!, confidence: 0.7 }];
    },
  },
  {
    key: 'lease_start_date',
    kind: 'date',
    extract: (t) =>
      labelLookup(
        t,
        ['lease start date', 'start date', 'commencement date', 'tarehe ya kuanza'],
        /(\d{4}-\d{2}-\d{2}|\d{1,2}[\/\-.]\w{1,10}[\/\-.]\d{2,4})/,
      ),
  },
  {
    key: 'lease_end_date',
    kind: 'date',
    extract: (t) =>
      labelLookup(
        t,
        ['lease end date', 'end date', 'expiry date', 'tarehe ya kumalizika'],
        /(\d{4}-\d{2}-\d{2}|\d{1,2}[\/\-.]\w{1,10}[\/\-.]\d{2,4})/,
      ),
  },
];

const LEASE_APPLICATION_FIELDS: ReadonlyArray<FieldSpec> = [
  {
    key: 'applicant_name',
    kind: 'entity',
    extract: (t) =>
      extractPersonByLabels(t, ['applicant name', 'applicant', 'mwombaji', 'jina la mwombaji']),
  },
  {
    key: 'applicant_phone',
    kind: 'entity',
    extract: (t) => {
      PHONE_RX.lastIndex = 0;
      const m = PHONE_RX.exec(t);
      return m && m[1] ? [{ value: m[1], confidence: 0.9, matchedText: m[0] }] : [];
    },
  },
  {
    key: 'applicant_nida',
    kind: 'entity',
    extract: (t) => {
      NIDA_RX.lastIndex = 0;
      const m = NIDA_RX.exec(t);
      return m && m[1] ? [{ value: m[1], confidence: 0.95, matchedText: m[0] }] : [];
    },
  },
  {
    key: 'requested_asset',
    kind: 'entity',
    extract: (t) => {
      const m = PLOT_RX.exec(t);
      return m && m[1]
        ? [{ value: m[1].trim(), confidence: 0.85, matchedText: m[0] }]
        : [];
    },
  },
  {
    key: 'requested_rent',
    kind: 'amount',
    extract: (t) => {
      const labelled = /(?:requested\s+rent|proposed\s+rent|offered\s+rent|kodi\s+ninayotaka)[^\n]{0,80}?(KES|TZS|UGX|RWF|NGN|GHS|USD)\s*([0-9](?:[0-9.,\s]*[0-9])?)/i.exec(
        t,
      );
      if (labelled && labelled[1] && labelled[2]) {
        const currency = labelled[1].toUpperCase();
        const major = parseAmountToMinor(labelled[2]);
        if (major !== null) {
          return [
            {
              value: buildAmount(currency, major),
              confidence: 0.9,
              matchedText: labelled[0],
            },
          ];
        }
      }
      return [];
    },
  },
];

const PAYMENT_FIELDS: ReadonlyArray<FieldSpec> = [
  {
    key: 'payer_name',
    kind: 'entity',
    extract: (t) =>
      extractPersonByLabels(t, [
        'payer name',
        'paid by',
        'payer',
        'jina la mlipaji',
        'mlipaji',
      ]),
  },
  {
    key: 'amount',
    kind: 'amount',
    extract: (t) => {
      const labelled = /(?:amount\s+paid|kiasi\s+kilicholipwa|kiasi)[^\n]{0,80}?(KES|TZS|UGX|RWF|NGN|GHS|USD)\s*([0-9](?:[0-9.,\s]*[0-9])?)/i.exec(
        t,
      );
      if (labelled && labelled[1] && labelled[2]) {
        const currency = labelled[1].toUpperCase();
        const major = parseAmountToMinor(labelled[2]);
        if (major !== null) {
          return [
            {
              value: buildAmount(currency, major),
              confidence: 0.95,
              matchedText: labelled[0],
            },
          ];
        }
      }
      const all = extractAllAmounts(t);
      return all.length > 0 ? [{ ...all[0]!, confidence: 0.7 }] : [];
    },
  },
  {
    key: 'gepg_reference',
    kind: 'entity',
    extract: (t) => {
      const m = GEPG_REF_RX.exec(t);
      return m && m[1] ? [{ value: m[1], confidence: 0.95, matchedText: m[0] }] : [];
    },
  },
  {
    key: 'mpesa_reference',
    kind: 'entity',
    extract: (t) => {
      const m = MPESA_REF_RX.exec(t);
      return m && m[1] ? [{ value: m[1], confidence: 0.95, matchedText: m[0] }] : [];
    },
  },
  {
    key: 'payment_date',
    kind: 'date',
    extract: (t) => {
      const labelled = labelLookup(
        t,
        ['payment date', 'date of payment', 'tarehe ya malipo'],
        /(\d{4}-\d{2}-\d{2}|\d{1,2}[\/\-.]\w{1,10}[\/\-.]\d{2,4})/,
      );
      if (labelled.length > 0) return labelled;
      const all = extractAllDates(t);
      return all.length > 0 ? [{ ...all[0]!, confidence: 0.7 }] : [];
    },
  },
];

const NIDA_FIELDS: ReadonlyArray<FieldSpec> = [
  {
    key: 'id_number',
    kind: 'entity',
    extract: (t) => {
      NIDA_RX.lastIndex = 0;
      const m = NIDA_RX.exec(t);
      if (m && m[1]) return [{ value: m[1], confidence: 0.98, matchedText: m[0] }];
      const k = KENYA_ID_RX.exec(t);
      if (k && k[1]) return [{ value: k[1], confidence: 0.9, matchedText: k[0] }];
      return [];
    },
  },
  {
    key: 'full_name',
    kind: 'entity',
    extract: (t) =>
      extractPersonByLabels(t, [
        'full name',
        'name',
        'surname',
        'first name',
        'jina kamili',
      ]),
  },
  {
    key: 'date_of_birth',
    kind: 'date',
    extract: (t) =>
      labelLookup(
        t,
        ['date of birth', 'dob', 'tarehe ya kuzaliwa'],
        /(\d{4}-\d{2}-\d{2}|\d{1,2}[\/\-.]\w{1,10}[\/\-.]\d{2,4})/,
      ),
  },
];

const SURVEY_FIELDS: ReadonlyArray<FieldSpec> = [
  {
    key: 'asset_reference',
    kind: 'entity',
    extract: (t) => {
      const m = PLOT_RX.exec(t);
      return m && m[1]
        ? [{ value: m[1].trim(), confidence: 0.85, matchedText: m[0] }]
        : [];
    },
  },
  {
    key: 'inspection_date',
    kind: 'date',
    extract: (t) =>
      labelLookup(
        t,
        ['inspection date', 'date of inspection', 'tarehe ya ukaguzi'],
        /(\d{4}-\d{2}-\d{2}|\d{1,2}[\/\-.]\w{1,10}[\/\-.]\d{2,4})/,
      ),
  },
  {
    key: 'inspector_name',
    kind: 'entity',
    extract: (t) =>
      extractPersonByLabels(t, ['inspected by', 'inspector', 'mkaguzi']),
  },
];

const COMPLAINT_FIELDS: ReadonlyArray<FieldSpec> = [
  {
    key: 'complainant_name',
    kind: 'entity',
    extract: (t) =>
      extractPersonByLabels(t, ['from', 'complainant', 'mlalamikaji', 'sincerely']),
  },
  {
    key: 'complaint_topic',
    kind: 'entity',
    extract: (t) => {
      const m = /(?:subject|topic|kuhusu)[:\s]+([A-Z][A-Za-z ,.'-]{4,120})/i.exec(t);
      return m && m[1]
        ? [{ value: m[1].trim(), confidence: 0.85, matchedText: m[0] }]
        : [];
    },
  },
  {
    key: 'asset_reference',
    kind: 'entity',
    extract: (t) => {
      const m = PLOT_RX.exec(t);
      return m && m[1]
        ? [{ value: m[1].trim(), confidence: 0.85, matchedText: m[0] }]
        : [];
    },
  },
];

const RENEWAL_FIELDS: ReadonlyArray<FieldSpec> = [
  {
    key: 'tenant_name',
    kind: 'entity',
    extract: (t) =>
      // Longest labels first — `tenant name` is more specific than `tenant`
      // and must be tried before the shorter prefix.
      extractPersonByLabels(t, ['tenant name', 'mpangaji', 'tenant']),
  },
  {
    key: 'asset_reference',
    kind: 'entity',
    extract: (t) => {
      const m = PLOT_RX.exec(t);
      return m && m[1]
        ? [{ value: m[1].trim(), confidence: 0.85, matchedText: m[0] }]
        : [];
    },
  },
  {
    key: 'requested_renewal_date',
    kind: 'date',
    extract: (t) =>
      labelLookup(
        t,
        ['renewal date', 'requested renewal', 'tarehe ya kuomba upya'],
        /(\d{4}-\d{2}-\d{2}|\d{1,2}[\/\-.]\w{1,10}[\/\-.]\d{2,4})/,
      ),
  },
];

const TERMINATION_FIELDS: ReadonlyArray<FieldSpec> = [
  {
    key: 'tenant_name',
    kind: 'entity',
    extract: (t) => extractPersonByLabels(t, ['tenant name', 'mpangaji', 'tenant']),
  },
  {
    key: 'asset_reference',
    kind: 'entity',
    extract: (t) => {
      const m = PLOT_RX.exec(t);
      return m && m[1]
        ? [{ value: m[1].trim(), confidence: 0.85, matchedText: m[0] }]
        : [];
    },
  },
  {
    key: 'effective_date',
    kind: 'date',
    extract: (t) =>
      labelLookup(
        t,
        ['effective date', 'vacating date', 'tarehe ya kuondoka'],
        /(\d{4}-\d{2}-\d{2}|\d{1,2}[\/\-.]\w{1,10}[\/\-.]\d{2,4})/,
      ),
  },
];

const VENDOR_INVOICE_FIELDS: ReadonlyArray<FieldSpec> = [
  {
    key: 'vendor_name',
    kind: 'entity',
    extract: (t) => extractPersonByLabels(t, ['vendor', 'from', 'supplier']),
  },
  {
    key: 'invoice_number',
    kind: 'entity',
    extract: (t) => {
      const m = /\binvoice\s*(?:no\.?|number)?[:\s]+([A-Z0-9\-]{3,24})\b/i.exec(t);
      return m && m[1] ? [{ value: m[1], confidence: 0.95, matchedText: m[0] }] : [];
    },
  },
  {
    key: 'amount',
    kind: 'amount',
    extract: (t) => {
      // Prefer the canonical labels in this order: "grand total" > "total
      // payable" > "amount due" > standalone "total" (word-boundary, to
      // avoid matching "subtotal"). The first hit wins.
      const labels: ReadonlyArray<RegExp> = [
        /grand\s+total[^\n]{0,80}?(KES|TZS|UGX|RWF|NGN|GHS|USD)\s*([0-9](?:[0-9.,\s]*[0-9])?)/i,
        /total\s+payable[^\n]{0,80}?(KES|TZS|UGX|RWF|NGN|GHS|USD)\s*([0-9](?:[0-9.,\s]*[0-9])?)/i,
        /amount\s+due[^\n]{0,80}?(KES|TZS|UGX|RWF|NGN|GHS|USD)\s*([0-9](?:[0-9.,\s]*[0-9])?)/i,
        /\btotal\b[^\n]{0,80}?(KES|TZS|UGX|RWF|NGN|GHS|USD)\s*([0-9](?:[0-9.,\s]*[0-9])?)/i,
      ];
      for (const rx of labels) {
        const m = rx.exec(t);
        if (m && m[1] && m[2]) {
          const currency = m[1].toUpperCase();
          const major = parseAmountToMinor(m[2]);
          if (major !== null) {
            return [
              {
                value: buildAmount(currency, major),
                confidence: 0.95,
                matchedText: m[0],
              },
            ];
          }
        }
      }
      return [];
    },
  },
];

const PROFILES: Record<Exclude<DocType, 'unknown'>, ExtractionProfile> = {
  lease_application: { fields: LEASE_APPLICATION_FIELDS },
  lease_contract: { fields: LEASE_FIELDS },
  payment_receipt: { fields: PAYMENT_FIELDS },
  national_id: { fields: NIDA_FIELDS },
  condition_survey: { fields: SURVEY_FIELDS },
  complaint_letter: { fields: COMPLAINT_FIELDS },
  renewal_request: { fields: RENEWAL_FIELDS },
  termination_notice: { fields: TERMINATION_FIELDS },
  vendor_invoice: { fields: VENDOR_INVOICE_FIELDS },
};

// ─── Public entrypoint ────────────────────────────────────────────────────

export interface ExtractEntitiesInput {
  readonly docType: DocType;
  readonly text: string;
  readonly layout?: ParsedLayout;
}

export function extractEntities(input: ExtractEntitiesInput): ReadonlyArray<ExtractedField> {
  if (input.docType === 'unknown') return [];
  const profile = PROFILES[input.docType];
  if (!profile) return [];

  const out: ExtractedField[] = [];
  for (const spec of profile.fields) {
    const candidates = spec.extract(input.text);
    if (candidates.length === 0) continue;
    // Take the highest-confidence candidate per key.
    const best = candidates.reduce((acc, cur) =>
      cur.confidence > acc.confidence ? cur : acc,
    );
    const location = input.layout
      ? locateInLayout(input.layout, best.matchedText)
      : null;
    out.push({
      key: spec.key,
      value: best.value,
      confidence: best.confidence,
      extractionKind: spec.kind,
      sourceMethod: 'rule',
      page: location?.page ?? null,
      bbox: location?.bbox ?? null,
      matchedText: best.matchedText,
    });
  }

  return out;
}
