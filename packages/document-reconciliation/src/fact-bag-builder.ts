/**
 * FactBag builder (LP-26).
 *
 * Projects a persisted document extraction (a flat field map) onto the
 * normalized {@link FactBag} the reconciler consumes. Pure + immutable;
 * never throws on partial / missing fields — an absent fact is simply left
 * undefined and the reconciler skips it.
 *
 * @module @borjie/document-reconciliation/fact-bag-builder
 */

import type { FactBag, FactField, MiningDocType, NormalizedName } from './types.js';

/** Minimal extracted field, matching the doc-ai extractor output shape. */
export interface ExtractedField {
  readonly field_name: string;
  readonly value: string | number | null | undefined;
  /** Confidence on a 0..100 scale (matches the extractor pipeline). */
  readonly confidence: number;
}

/** Minimal projection of a persisted extraction needed to build a FactBag. */
export interface ExtractionForReconciliation {
  readonly documentId: string;
  readonly docType: MiningDocType;
  readonly fields: readonly ExtractedField[];
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 1;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

/** Read the first field whose name matches (case-insensitive). */
function readField(
  fields: readonly ExtractedField[],
  names: readonly string[],
): { value: string; confidence: number } | undefined {
  const wanted = new Set(names.map((n) => n.toLowerCase()));
  for (const f of fields) {
    if (!wanted.has(f.field_name.toLowerCase())) continue;
    if (f.value === null || f.value === undefined) continue;
    const value = String(f.value).trim();
    if (value.length === 0) continue;
    return { value, confidence: clamp01(f.confidence / 100) };
  }
  return undefined;
}

function buildName(full?: string, first?: string, last?: string): NormalizedName | undefined {
  const fullStr = (full ?? [first, last].filter(Boolean).join(' ')).trim();
  if (!fullStr) return undefined;
  if (first && last) {
    return { first, last, full: fullStr.toUpperCase() };
  }
  const parts = fullStr.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return undefined;
  return {
    first: parts[0] ?? fullStr,
    ...(parts.length > 2 ? { middle: parts.slice(1, -1).join(' ') } : {}),
    last: parts.length > 1 ? (parts[parts.length - 1] ?? '') : (parts[0] ?? fullStr),
    full: fullStr.toUpperCase(),
  };
}

/**
 * Project a single extraction onto a FactBag. Returns undefined when the
 * document carries no comparable identity / financial facts at all.
 */
export function buildFactBag(extraction: ExtractionForReconciliation): FactBag | undefined {
  const { fields } = extraction;

  const nameField = readField(fields, ['full_name', 'name', 'holder_name', 'licensee_name', 'taxpayer_name']);
  const firstField = readField(fields, ['first_name']);
  const lastField = readField(fields, ['last_name', 'surname']);
  const primaryName = buildName(nameField?.value, firstField?.value, lastField?.value);

  const dobField = readField(fields, ['date_of_birth', 'dob']);
  const nationalIdField = readField(fields, ['national_id_number', 'nida_number', 'id_number']);
  const tinField = readField(fields, ['tin_number', 'tin']);
  const amountField = readField(fields, ['amount', 'royalty_amount', 'total']);

  const phones: string[] = [];
  for (const name of ['phone', 'phone_number', 'mobile', 'telephone']) {
    const p = readField(fields, [name]);
    if (p) phones.push(p.value);
  }

  const amount = amountField ? Number(amountField.value.replace(/[^\d.]/g, '')) : undefined;
  const hasAmount = typeof amount === 'number' && Number.isFinite(amount) && amount > 0;

  if (!primaryName && !dobField && !nationalIdField && !tinField && phones.length === 0 && !hasAmount) {
    return undefined;
  }

  const fieldConfidences: Record<FactField, number> = {
    primaryName: nameField?.confidence ?? firstField?.confidence ?? 1,
    dateOfBirth: dobField?.confidence ?? 1,
    nationalId: nationalIdField?.confidence ?? 1,
    tin: tinField?.confidence ?? 1,
    phones: 1,
    addresses: 1,
    bankAccounts: 1,
    amount: amountField?.confidence ?? 1,
  };

  return {
    ...(primaryName ? { primaryName } : {}),
    ...(dobField ? { dateOfBirth: dobField.value } : {}),
    ...(nationalIdField ? { nationalId: nationalIdField.value.replace(/\D/g, '') } : {}),
    ...(tinField ? { tin: tinField.value.replace(/\D/g, '') } : {}),
    ...(hasAmount ? { amount } : {}),
    phones: Object.freeze(phones),
    addresses: Object.freeze([]),
    bankAccounts: Object.freeze([]),
    sourceDocId: extraction.documentId,
    sourceDocType: extraction.docType,
    fieldConfidences,
  };
}

/** Build FactBags for a batch, dropping documents with no comparable facts. */
export function buildFactBags(
  extractions: readonly ExtractionForReconciliation[],
): readonly FactBag[] {
  const bags: FactBag[] = [];
  for (const e of extractions) {
    const bag = buildFactBag(e);
    if (bag) bags.push(bag);
  }
  return bags;
}
