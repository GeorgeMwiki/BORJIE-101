/**
 * Piece L — Regex entity extractor.
 *
 * Self-contained NER for dispatch-router. Pulls out structured mentions
 * from a user/assistant exchange: customer names (capitalised noun
 * phrases), unit IDs, property IDs, amounts, dates, districts, lease
 * IDs, document IDs.
 *
 * This is a thin port over the ai-copilot regex extractor with three
 * additions:
 *   1. Person-name heuristics (Mr/Mrs/Bw./Ms.) for customer extraction.
 *   2. Lease/invoice/ticket id patterns (le_*, inv_*, mt_*) — useful
 *      when the assistant reply already references existing entities.
 *   3. Generic property names that overlap with persona conventions
 *      ("godown N", "shop M", "apartment K").
 *
 * Output entities have NOT yet been canonicalized — they're raw
 * mentions. The capture pipeline pipes them through the resolver,
 * which drops any that can't be canonically mapped.
 */

export interface RawEntity {
  readonly raw_type: string;
  readonly value: string;
  readonly confidence: number;
}

const HONORIFIC_RE =
  /\b(?:Mr|Mrs|Ms|Mme|Bw|Bibi|Mama|Baba|Mama|Dr)\.?\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,3})\b/g;
// Standalone capitalised names (two-word fallback) — lower confidence
const NAMEPAIR_RE = /\b([A-Z][a-z]{2,}\s+[A-Z][a-z]{2,})\b/g;

const PROPERTY_ID_RE = /\b(prop|property)[_-]?([A-Z0-9]{4,12})\b/gi;
const UNIT_ID_RE =
  /\b(?:unit|apt|apartment|flat|godown|shop|stall|office)\s+([A-Z0-9]+(?:-[A-Z0-9]+)?)\b/gi;
const LEASE_ID_RE = /\b(?:le[_-])([A-Za-z0-9_]{4,20})\b/g;
const INVOICE_ID_RE = /\b(?:inv[_-])([A-Za-z0-9_]{4,20})\b/g;
const TICKET_ID_RE = /\b(?:mt[_-]|ticket\s+#?)([A-Za-z0-9_]{4,20})\b/g;
const DOCUMENT_ID_RE = /\b(?:doc[_-])([A-Za-z0-9_]{4,20})\b/g;

// Amount: digit-grouped or plain digits, optional unit suffix or currency
// (k/m/M for thousand/million; tzs/tsh/sh/kes/ksh/ngn/usd/eur).
const AMOUNT_RE =
  /(\d{1,3}(?:[,\s]\d{3})+|\d+(?:\.\d+)?)\s*(k|m|M|tzs|tsh|sh|kes|ksh|ngn|usd|eur|shillings)?\b/gi;

const DATE_ISO_RE = /\b(\d{4}-\d{2}-\d{2})\b/g;
const DATE_LONG_RE =
  /\b(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{4})\b/gi;
// Month-only: "from Jan" / "starting January 2026" / "in Feb"
const DATE_MONTH_RE =
  /\b(?:from|starting|in|by|until)\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*(?:\s+\d{4})?\b/gi;

const DISTRICTS = [
  'Kinondoni',
  'Ilala',
  'Temeke',
  'Ubungo',
  'Kigamboni',
  'Goba',
  'Mbezi',
  'Kariakoo',
  'Masaki',
  'Mikocheni',
  'Westlands',
  'Lavington',
  'Karen',
  'Kilimani',
  'Lekki',
  'Victoria Island',
  'Ikoyi',
];

/**
 * Extract all raw entity mentions from the combined text. Confidence
 * values are heuristic; the canonical resolver re-scores during
 * resolution.
 */
export function extractRawEntities(text: string): ReadonlyArray<RawEntity> {
  if (!text) return [];
  const out: RawEntity[] = [];

  for (const m of text.matchAll(HONORIFIC_RE)) {
    const v = m[1];
    if (!v) continue;
    out.push({
      raw_type: 'customer',
      value: v,
      confidence: 0.9,
    });
  }

  // Standalone capitalised name pairs — only add if we haven't already
  // captured the same name via honorific (avoid double-counting).
  const seenNames = new Set(
    out
      .filter((e) => e.raw_type === 'customer')
      .map((e) => e.value.toLowerCase()),
  );
  for (const m of text.matchAll(NAMEPAIR_RE)) {
    const cand = m[1];
    if (!cand) continue;
    if (!seenNames.has(cand.toLowerCase())) {
      // Filter common false positives (sentence starts at capitalised words).
      if (!isLikelySentenceStart(cand)) {
        out.push({
          raw_type: 'customer',
          value: cand,
          confidence: 0.7,
        });
        seenNames.add(cand.toLowerCase());
      }
    }
  }

  for (const m of text.matchAll(PROPERTY_ID_RE)) {
    const v = m[2];
    if (!v) continue;
    out.push({
      raw_type: 'property',
      value: v.toUpperCase(),
      confidence: 0.9,
    });
  }

  for (const m of text.matchAll(UNIT_ID_RE)) {
    const fullMatch = m[0];
    const id = m[1]?.toUpperCase();
    if (!id) continue;
    // For "godown 3" we want to preserve "godown" qualifier in raw_value
    // so the resolver can disambiguate against "unit 3" or "shop 3".
    const head = fullMatch.split(/\s+/)[0] ?? '';
    out.push({
      raw_type: 'unit',
      value: `${head} ${id}`.toLowerCase(),
      confidence: 0.85,
    });
  }

  for (const m of text.matchAll(LEASE_ID_RE)) {
    const v = m[1];
    if (!v) continue;
    out.push({
      raw_type: 'lease',
      value: `le_${v}`,
      confidence: 0.95,
    });
  }
  for (const m of text.matchAll(INVOICE_ID_RE)) {
    const v = m[1];
    if (!v) continue;
    out.push({
      raw_type: 'invoice',
      value: `inv_${v}`,
      confidence: 0.95,
    });
  }
  for (const m of text.matchAll(TICKET_ID_RE)) {
    const v = m[1];
    if (!v) continue;
    out.push({
      raw_type: 'maintenance_ticket',
      value: v,
      confidence: 0.9,
    });
  }
  for (const m of text.matchAll(DOCUMENT_ID_RE)) {
    const v = m[1];
    if (!v) continue;
    out.push({
      raw_type: 'document',
      value: `doc_${v}`,
      confidence: 0.95,
    });
  }

  for (const m of text.matchAll(AMOUNT_RE)) {
    const rawNum = m[1];
    if (!rawNum) continue;
    const num = rawNum.replace(/[,\s]/g, '');
    const suffix = (m[2] ?? '').toLowerCase();
    if (suffix === '' && Number(num) < 100) continue; // not a money amount
    let normalised = Number(num);
    if (suffix === 'k') normalised *= 1_000;
    else if (suffix === 'm') normalised *= 1_000_000;
    out.push({
      raw_type: 'amount',
      value: String(normalised),
      confidence: suffix ? 0.85 : 0.7,
    });
  }

  for (const m of text.matchAll(DATE_ISO_RE)) {
    const v = m[1];
    if (!v) continue;
    out.push({ raw_type: 'date', value: v, confidence: 0.95 });
  }
  for (const m of text.matchAll(DATE_LONG_RE)) {
    const v = m[1];
    if (!v) continue;
    out.push({ raw_type: 'date', value: v, confidence: 0.85 });
  }
  for (const m of text.matchAll(DATE_MONTH_RE)) {
    out.push({ raw_type: 'date', value: m[0], confidence: 0.7 });
  }

  for (const district of DISTRICTS) {
    const re = new RegExp(`\\b${district}\\b`, 'i');
    if (re.test(text)) {
      out.push({ raw_type: 'district', value: district, confidence: 0.9 });
    }
  }

  return dedupe(out);
}

function dedupe(es: ReadonlyArray<RawEntity>): ReadonlyArray<RawEntity> {
  const seen = new Set<string>();
  const out: RawEntity[] = [];
  for (const e of es) {
    const key = `${e.raw_type}:${e.value.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

/**
 * Heuristic to filter false-positive customer extractions: phrases
 * that start a sentence with capitalised words (e.g. "I Want To" or
 * "Please Look").
 */
function isLikelySentenceStart(name: string): boolean {
  const sentenceStarters = new Set([
    'I Want',
    'You Want',
    'We Want',
    'They Want',
    'Please Find',
    'Please Look',
    'Please Note',
    'Let Me',
    'Let Us',
    'Thank You',
    'Good Morning',
    'Good Afternoon',
    'Good Evening',
  ]);
  return sentenceStarters.has(name);
}
