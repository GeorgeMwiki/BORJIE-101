/**
 * Cross-document fact matchers (LP-26).
 *
 * Each matcher is pure, deterministic, immutable, and never throws — an
 * empty / undefined input produces `matched=false` with a reason code so the
 * reconciler can decide whether to flag it.
 *
 * @module @borjie/document-reconciliation/fact-matcher
 */

import {
  NAME_LEVENSHTEIN_SOFT_THRESHOLD,
  NAME_SUBSET_MAX_TOKEN_DELTA,
  ADDRESS_SIMILARITY_MATCH_THRESHOLD,
  REASON_CODES,
  DEFAULT_COUNTRY_CODE,
  FIELD_CRITICALITY,
  STRICT_IDENTITY_FIELDS,
  LOW_CONFIDENCE_DOWNGRADE_THRESHOLD,
  type NormalizedName,
  type NormalizedAddress,
  type E164Phone,
  type NameMatchResult,
  type AddressMatchResult,
  type DateTolerance,
  type FactBag,
  type Match,
  type Mismatch,
  type MismatchSeverity,
  type ReconciliationReport,
  type Blocker,
  type SoftFlag,
  type FactField,
} from './types.js';

// ----------------------------------------------------------------------------
// Levenshtein distance (O(m*n) time, O(min) space)
// ----------------------------------------------------------------------------

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const [short, long] = a.length <= b.length ? ([a, b] as const) : ([b, a] as const);
  let prev: readonly number[] = Array.from({ length: short.length + 1 }, (_, i) => i);

  for (let i = 1; i <= long.length; i += 1) {
    const next: number[] = new Array(short.length + 1);
    next[0] = i;
    for (let j = 1; j <= short.length; j += 1) {
      const cost = long.charCodeAt(i - 1) === short.charCodeAt(j - 1) ? 0 : 1;
      next[j] = Math.min(
        (next[j - 1] ?? 0) + 1,
        (prev[j] ?? 0) + 1,
        (prev[j - 1] ?? 0) + cost,
      );
    }
    prev = next;
  }
  return prev[short.length] ?? 0;
}

// ----------------------------------------------------------------------------
// Name matching
// ----------------------------------------------------------------------------

function normalizeNameToken(s: string): string {
  return s.replace(/[.\-_'`]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

function tokensOf(name: NormalizedName): readonly string[] {
  const fromParts = [name.first, name.middle, name.last]
    .filter((p): p is string => !!p && p.length > 0)
    .map(normalizeNameToken);
  if (fromParts.length > 0) return fromParts;
  return normalizeNameToken(name.full).split(' ').filter((t) => t.length > 0);
}

function initials(tokens: readonly string[]): string {
  return tokens.map((t) => t.charAt(0)).join('');
}

/**
 * Two names match when (in priority order): exact normalized equality;
 * token-set equality regardless of order (catches first/last swaps);
 * initials-vs-full match; Levenshtein within threshold; or one token set is
 * a subset of the other (middle-name presence/absence).
 */
export function matchNames(
  a: NormalizedName | undefined,
  b: NormalizedName | undefined,
): NameMatchResult {
  if (!a || !b) {
    return {
      matched: false,
      distance: Number.POSITIVE_INFINITY,
      reasons: [REASON_CODES.COMPLETELY_DIFFERENT],
      swapDetected: false,
    };
  }

  const tokensA = tokensOf(a);
  const tokensB = tokensOf(b);
  const fullA = tokensA.join(' ');
  const fullB = tokensB.join(' ');

  if (fullA === fullB) {
    return { matched: true, distance: 0, reasons: [REASON_CODES.EXACT_MATCH], swapDetected: false };
  }

  const sortedA = [...tokensA].sort().join(' ');
  const sortedB = [...tokensB].sort().join(' ');
  if (sortedA === sortedB) {
    const reasons: string[] = [REASON_CODES.NORMALIZED_MATCH];
    const swap =
      tokensA.length >= 2 &&
      tokensB.length >= 2 &&
      tokensA[0] === tokensB[tokensB.length - 1] &&
      tokensA[tokensA.length - 1] === tokensB[0];
    if (swap) reasons.push(REASON_CODES.NAME_SWAP_DETECTED);
    return { matched: true, distance: 0, reasons: Object.freeze(reasons), swapDetected: swap };
  }

  const aIsInitials = tokensA.every((t) => t.length === 1);
  const bIsInitials = tokensB.every((t) => t.length === 1);
  if (aIsInitials !== bIsInitials) {
    const initialsSide = aIsInitials ? fullA.replace(/\s+/g, '') : fullB.replace(/\s+/g, '');
    const otherInitials = aIsInitials ? initials(tokensB) : initials(tokensA);
    if (initialsSide === otherInitials) {
      return { matched: true, distance: 0, reasons: [REASON_CODES.INITIALS_MATCH], swapDetected: false };
    }
  }

  const distance = levenshtein(fullA, fullB);
  if (distance <= NAME_LEVENSHTEIN_SOFT_THRESHOLD) {
    const reasons: string[] = [REASON_CODES.LEVENSHTEIN_WITHIN_THRESHOLD];
    if (tokensA.length !== tokensB.length) reasons.push(REASON_CODES.MIDDLE_NAME_DIFFERS);
    return { matched: true, distance, reasons: Object.freeze(reasons), swapDetected: false };
  }

  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  const aSubset = tokensA.every((t) => setB.has(t));
  const bSubset = tokensB.every((t) => setA.has(t));
  if (aSubset || bSubset) {
    // A subset is only a STRICT same-person match when the size gap is small
    // (one missing/extra middle name). A larger gap leaves too many
    // unexplained tokens — e.g. 'Juma Kessy' is a subset of 'Juma Hassan
    // Kessy Mwita' but they may be different people — so it is a mismatch
    // rather than a silent match.
    const tokenDelta = Math.abs(tokensA.length - tokensB.length);
    if (tokenDelta <= NAME_SUBSET_MAX_TOKEN_DELTA) {
      return { matched: true, distance, reasons: [REASON_CODES.MIDDLE_NAME_DIFFERS], swapDetected: false };
    }
    return {
      matched: false,
      distance,
      reasons: Object.freeze([REASON_CODES.MIDDLE_NAME_DIFFERS, REASON_CODES.COMPLETELY_DIFFERENT]),
      swapDetected: false,
    };
  }

  return { matched: false, distance, reasons: [REASON_CODES.COMPLETELY_DIFFERENT], swapDetected: false };
}

// ----------------------------------------------------------------------------
// Phone matching
// ----------------------------------------------------------------------------

/**
 * Normalize a phone to +<cc><national> for the default jurisdiction.
 * Returns null when the digit count is unrecognisable (rather than throwing).
 */
export function normalizePhone(input: string, countryCode = DEFAULT_COUNTRY_CODE): E164Phone | null {
  const digits = input.replace(/\D/g, '');
  if (digits.length === 0) return null;

  if (digits.startsWith(countryCode)) {
    return digits.length === countryCode.length + 9 ? `+${digits}` : null;
  }
  if (digits.startsWith('0')) {
    const rest = digits.slice(1);
    return rest.length === 9 ? `+${countryCode}${rest}` : null;
  }
  if (digits.length === 9 && /^[67]/.test(digits)) {
    return `+${countryCode}${digits}`;
  }
  return null;
}

export function matchPhones(a: string, b: string): boolean {
  const na = normalizePhone(a);
  const nb = normalizePhone(b);
  if (na === null || nb === null) {
    const ra = a.replace(/\D/g, '');
    const rb = b.replace(/\D/g, '');
    if (ra.length === 0 || rb.length === 0) return false;
    return ra === rb;
  }
  return na === nb;
}

// ----------------------------------------------------------------------------
// Address matching (Jaccard over token sets)
// ----------------------------------------------------------------------------

const PO_BOX_RE = /\bP[.\s]*O[.\s]*BOX\b/i;
const PO_BOX_NORMALIZED = 'PO BOX';

export function canonicalizeAddressString(s: string): string {
  return s
    .replace(/[,.;:]/g, ' ')
    .replace(PO_BOX_RE, PO_BOX_NORMALIZED)
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function addressTokens(addr: NormalizedAddress): Set<string> {
  const parts = [
    canonicalizeAddressString(addr.raw),
    addr.region?.toUpperCase(),
    addr.district?.toUpperCase(),
    addr.street?.toUpperCase(),
    addr.poBox ? `${PO_BOX_NORMALIZED} ${addr.poBox.replace(/\D/g, '')}` : undefined,
  ].filter((p): p is string => !!p && p.length > 0);

  const tokens = new Set<string>();
  for (const p of parts) {
    for (const tok of p.split(' ')) {
      if (tok.length >= 2) tokens.add(tok);
    }
  }
  return tokens;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const tok of a) if (b.has(tok)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function matchAddresses(
  a: NormalizedAddress | undefined,
  b: NormalizedAddress | undefined,
): AddressMatchResult {
  if (!a || !b) {
    return { matched: false, similarity: 0, reasons: [REASON_CODES.COMPLETELY_DIFFERENT] };
  }
  const sim = jaccard(addressTokens(a), addressTokens(b));
  const reasons: string[] = [];
  if (a.region && b.region && a.region.toUpperCase() === b.region.toUpperCase()) {
    reasons.push(REASON_CODES.ADDRESS_REGION_MATCH);
  }
  if (sim >= ADDRESS_SIMILARITY_MATCH_THRESHOLD) {
    reasons.push(REASON_CODES.ADDRESS_FUZZY_MATCH);
    return { matched: true, similarity: sim, reasons: Object.freeze(reasons) };
  }
  return {
    matched: false,
    similarity: sim,
    reasons: reasons.length > 0 ? Object.freeze(reasons) : [REASON_CODES.COMPLETELY_DIFFERENT],
  };
}

// ----------------------------------------------------------------------------
// Date matching
// ----------------------------------------------------------------------------

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseIsoDate(s: string): { y: number; m: number; d: number } | null {
  if (!ISO_DATE_RE.test(s)) return null;
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(5, 7));
  const d = Number(s.slice(8, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { y, m, d };
}

export function matchDates(a: string, b: string, tolerance: DateTolerance = 'exact'): boolean {
  const da = parseIsoDate(a);
  const db = parseIsoDate(b);
  if (da === null || db === null) return false;
  switch (tolerance) {
    case 'exact':
      return da.y === db.y && da.m === db.m && da.d === db.d;
    case 'monthYear':
      return da.y === db.y && da.m === db.m;
    case 'year':
      return da.y === db.y;
    default: {
      const _exhaustive: never = tolerance;
      return _exhaustive;
    }
  }
}

// ----------------------------------------------------------------------------
// Amount matching
// ----------------------------------------------------------------------------

/**
 * Match two monetary amounts within a relative tolerance (default 0.5%) to
 * absorb rounding / fee noise across documents. Both must be finite + > 0.
 */
export function matchAmounts(a: number, b: number, relTolerance = 0.005): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  if (a <= 0 || b <= 0) return false;
  const diff = Math.abs(a - b);
  return diff <= Math.max(a, b) * relTolerance;
}

// ----------------------------------------------------------------------------
// Bank account matching
// ----------------------------------------------------------------------------

export function matchBankAccounts(
  a: { bank: string; accountNumber: string },
  b: { bank: string; accountNumber: string },
): boolean {
  if (a.bank.toUpperCase().trim() !== b.bank.toUpperCase().trim()) return false;
  const an = a.accountNumber.replace(/\D/g, '');
  const bn = b.accountNumber.replace(/\D/g, '');
  if (an.length === 0 || bn.length === 0) return false;
  return an === bn;
}

// ----------------------------------------------------------------------------
// Batch reconciler
// ----------------------------------------------------------------------------

function src(bag: FactBag, field: FactField) {
  return {
    docId: bag.sourceDocId,
    docType: bag.sourceDocType,
    confidence: bag.fieldConfidences[field] ?? 1,
  };
}

function severityFor(field: FactField, leftConf: number, rightConf: number): MismatchSeverity {
  const conf = Math.min(leftConf, rightConf);
  const strictByField = STRICT_IDENTITY_FIELDS.includes(field);
  if (strictByField && conf >= LOW_CONFIDENCE_DOWNGRADE_THRESHOLD) return 'STRICT_MISMATCH';
  if (field === 'primaryName' && conf >= LOW_CONFIDENCE_DOWNGRADE_THRESHOLD) return 'STRICT_MISMATCH';
  // A different payout bank account across documents is a hard block (a high
  // criticality fraud/mis-pay signal), not a soft flag, when both reads are
  // confident.
  if (field === 'bankAccounts' && conf >= LOW_CONFIDENCE_DOWNGRADE_THRESHOLD) return 'STRICT_MISMATCH';
  return 'SOFT_MISMATCH';
}

function reconcileName(a: FactBag, b: FactBag, matches: Match[], mismatches: Mismatch[]): void {
  if (!a.primaryName || !b.primaryName) return;
  const result = matchNames(a.primaryName, b.primaryName);
  if (result.matched) {
    matches.push({
      field: 'primaryName',
      leftValue: a.primaryName.full,
      rightValue: b.primaryName.full,
      left: src(a, 'primaryName'),
      right: src(b, 'primaryName'),
    });
    return;
  }
  const severity = severityFor(
    'primaryName',
    a.fieldConfidences.primaryName ?? 1,
    b.fieldConfidences.primaryName ?? 1,
  );
  mismatches.push({
    field: 'primaryName',
    severity,
    leftValue: a.primaryName.full,
    rightValue: b.primaryName.full,
    left: src(a, 'primaryName'),
    right: src(b, 'primaryName'),
    reasonCodes: result.reasons,
    explanation: `name mismatch between ${a.sourceDocType} and ${b.sourceDocType}`,
  });
}

function reconcileScalar(
  a: FactBag,
  b: FactBag,
  field: FactField,
  read: (bag: FactBag) => string,
  matches: Match[],
  mismatches: Mismatch[],
): void {
  const av = read(a);
  const bv = read(b);
  if (!av || !bv) return;
  if (av === bv) {
    matches.push({ field, leftValue: av, rightValue: bv, left: src(a, field), right: src(b, field) });
    return;
  }
  mismatches.push({
    field,
    severity: severityFor(field, a.fieldConfidences[field] ?? 1, b.fieldConfidences[field] ?? 1),
    leftValue: av,
    rightValue: bv,
    left: src(a, field),
    right: src(b, field),
    reasonCodes: [REASON_CODES.COMPLETELY_DIFFERENT],
    explanation: `${field} differs between ${a.sourceDocType} and ${b.sourceDocType}`,
  });
}

function reconcilePhones(a: FactBag, b: FactBag, matches: Match[], mismatches: Mismatch[]): void {
  if (a.phones.length === 0 || b.phones.length === 0) return;
  let anyMatch = false;
  for (const pa of a.phones) {
    for (const pb of b.phones) {
      if (matchPhones(pa, pb)) {
        matches.push({ field: 'phones', leftValue: pa, rightValue: pb, left: src(a, 'phones'), right: src(b, 'phones') });
        anyMatch = true;
      }
    }
  }
  if (!anyMatch) {
    mismatches.push({
      field: 'phones',
      severity: 'SOFT_MISMATCH',
      leftValue: a.phones.join(','),
      rightValue: b.phones.join(','),
      left: src(a, 'phones'),
      right: src(b, 'phones'),
      reasonCodes: [REASON_CODES.COMPLETELY_DIFFERENT],
      explanation: `no overlapping phone between ${a.sourceDocType} and ${b.sourceDocType}`,
    });
  }
}

function reconcileAddresses(a: FactBag, b: FactBag, matches: Match[], mismatches: Mismatch[]): void {
  if (a.addresses.length === 0 || b.addresses.length === 0) return;
  let best: AddressMatchResult | null = null;
  for (const aa of a.addresses) {
    for (const ba of b.addresses) {
      const result = matchAddresses(aa, ba);
      if (result.matched) {
        matches.push({
          field: 'addresses',
          leftValue: aa.raw,
          rightValue: ba.raw,
          left: src(a, 'addresses'),
          right: src(b, 'addresses'),
        });
        return;
      }
      if (!best || result.similarity > best.similarity) best = result;
    }
  }
  mismatches.push({
    field: 'addresses',
    severity: severityFor('addresses', a.fieldConfidences.addresses ?? 1, b.fieldConfidences.addresses ?? 1),
    leftValue: a.addresses.map((x) => x.raw).join(' | '),
    rightValue: b.addresses.map((x) => x.raw).join(' | '),
    left: src(a, 'addresses'),
    right: src(b, 'addresses'),
    reasonCodes: best ? best.reasons : [REASON_CODES.COMPLETELY_DIFFERENT],
    explanation: `no matching address between ${a.sourceDocType} and ${b.sourceDocType}`,
  });
}

function reconcileBankAccounts(a: FactBag, b: FactBag, matches: Match[], mismatches: Mismatch[]): void {
  if (a.bankAccounts.length === 0 || b.bankAccounts.length === 0) return;
  for (const aa of a.bankAccounts) {
    for (const ba of b.bankAccounts) {
      if (matchBankAccounts(aa, ba)) {
        matches.push({
          field: 'bankAccounts',
          leftValue: `${aa.bank} ${aa.accountNumber}`,
          rightValue: `${ba.bank} ${ba.accountNumber}`,
          left: src(a, 'bankAccounts'),
          right: src(b, 'bankAccounts'),
        });
        return;
      }
    }
  }
  mismatches.push({
    field: 'bankAccounts',
    severity: severityFor('bankAccounts', a.fieldConfidences.bankAccounts ?? 1, b.fieldConfidences.bankAccounts ?? 1),
    leftValue: a.bankAccounts.map((x) => `${x.bank} ${x.accountNumber}`).join(' | '),
    rightValue: b.bankAccounts.map((x) => `${x.bank} ${x.accountNumber}`).join(' | '),
    left: src(a, 'bankAccounts'),
    right: src(b, 'bankAccounts'),
    reasonCodes: [REASON_CODES.COMPLETELY_DIFFERENT],
    explanation: `different bank account between ${a.sourceDocType} and ${b.sourceDocType}`,
  });
}

function reconcileAmount(a: FactBag, b: FactBag, matches: Match[], mismatches: Mismatch[]): void {
  if (a.amount === undefined || b.amount === undefined) return;
  if (matchAmounts(a.amount, b.amount)) {
    matches.push({
      field: 'amount',
      leftValue: String(a.amount),
      rightValue: String(b.amount),
      left: src(a, 'amount'),
      right: src(b, 'amount'),
    });
    return;
  }
  mismatches.push({
    field: 'amount',
    severity: severityFor('amount', a.fieldConfidences.amount ?? 1, b.fieldConfidences.amount ?? 1),
    leftValue: String(a.amount),
    rightValue: String(b.amount),
    left: src(a, 'amount'),
    right: src(b, 'amount'),
    reasonCodes: [REASON_CODES.COMPLETELY_DIFFERENT],
    explanation: `amount differs between ${a.sourceDocType} and ${b.sourceDocType}`,
  });
}

/**
 * Run every pairwise reconciliation across a batch of FactBags and summarise
 * matches + mismatches. STRICT mismatches become blockers; SOFT mismatches
 * become soft flags. `overallConsistency` is a criticality-weighted ratio of
 * matched pairs over compared pairs.
 */
export function reconcileDocBatch(facts: readonly FactBag[]): ReconciliationReport {
  if (facts.length < 2) {
    return { mismatches: [], matches: [], overallConsistency: 1, blockers: [], softFlags: [] };
  }

  const mismatches: Mismatch[] = [];
  const matches: Match[] = [];

  for (let i = 0; i < facts.length; i += 1) {
    for (let j = i + 1; j < facts.length; j += 1) {
      const a = facts[i];
      const b = facts[j];
      if (!a || !b) continue;
      reconcileName(a, b, matches, mismatches);
      reconcileScalar(a, b, 'dateOfBirth', (x) => x.dateOfBirth ?? '', matches, mismatches);
      reconcileScalar(a, b, 'nationalId', (x) => x.nationalId ?? '', matches, mismatches);
      reconcileScalar(a, b, 'tin', (x) => x.tin ?? '', matches, mismatches);
      reconcilePhones(a, b, matches, mismatches);
      reconcileAddresses(a, b, matches, mismatches);
      reconcileBankAccounts(a, b, matches, mismatches);
      reconcileAmount(a, b, matches, mismatches);
    }
  }

  let totalWeight = 0;
  let matchedWeight = 0;
  for (const m of matches) {
    const w = FIELD_CRITICALITY[m.field] ?? 0.5;
    totalWeight += w;
    matchedWeight += w;
  }
  const blockers: Blocker[] = [];
  const softFlags: SoftFlag[] = [];
  for (const m of mismatches) {
    totalWeight += FIELD_CRITICALITY[m.field] ?? 0.5;
    const entry = { field: m.field, explanation: m.explanation, involvedDocIds: [m.left.docId, m.right.docId] };
    if (m.severity === 'STRICT_MISMATCH') blockers.push(entry);
    else softFlags.push(entry);
  }

  const overallConsistency = totalWeight === 0 ? 1 : matchedWeight / totalWeight;

  return {
    mismatches: Object.freeze(mismatches),
    matches: Object.freeze(matches),
    overallConsistency: Number(overallConsistency.toFixed(4)),
    blockers: Object.freeze(blockers),
    softFlags: Object.freeze(softFlags),
  };
}
