/**
 * Jurisdiction detector — JA-1 helper.
 *
 * Pure-function classifier that scans a user message for an explicit
 * jurisdiction mention. Examples:
 *   - "in Kenya we file ..."           → KE
 *   - "for our Uganda operation"       → UG
 *   - "what if I export to South Africa" → ZA
 *   - "we operate in Mwadui, Tanzania" → TZ
 *   - "in Peru"                        → PE (unseeded)
 *   - "I'm thinking about KE"          → KE (alpha-2 literal)
 *
 * The detector returns ISO-3166-1 alpha-2 codes. Match priority:
 *   1. Country names (case-insensitive, with `in / for / from / to`
 *      preposition or boundary).
 *   2. Bare alpha-2 codes after `in / for / from / to / our`.
 *   3. Region/city hints we have an explicit map for (Mwadui →
 *      TZ, Tarkwa → GH, etc.).
 *
 * This is NOT a regex-of-the-world — it is deliberately small. The
 * list expands as we add jurisdictions (KE/UG/NG/ZA/AU/CL/ID +
 * historical mentions Peru/Ghana/Mali for graceful unseeded
 * fallback).
 */

interface CountryEntry {
  readonly code: string;
  readonly names: ReadonlyArray<string>;
  /** Region / city hints that should resolve to this country. */
  readonly hints: ReadonlyArray<string>;
}

const COUNTRY_TABLE: ReadonlyArray<CountryEntry> = Object.freeze([
  Object.freeze({
    code: 'TZ',
    names: ['tanzania', 'tz'],
    hints: [
      'mwadui',
      'geita',
      'mererani',
      'songwe',
      'kahama',
      'tunduru',
      'lindi',
      'mahenge',
      'mbeya',
      'bagamoyo',
      'uvinza',
      'tanga',
      'songea',
      'chunya',
      'singida',
      'manyoni',
      'dar es salaam',
      'dodoma',
      'arusha',
    ],
  }),
  Object.freeze({
    code: 'KE',
    names: ['kenya', 'ke'],
    hints: ['nairobi', 'mombasa', 'kakamega', 'migori', 'turkana', 'kwale'],
  }),
  Object.freeze({
    code: 'UG',
    names: ['uganda', 'ug'],
    hints: ['kampala', 'mubende', 'busia', 'karamoja'],
  }),
  Object.freeze({
    code: 'NG',
    names: ['nigeria', 'ng'],
    hints: ['lagos', 'abuja', 'jos', 'kaduna', 'enugu', 'plateau'],
  }),
  Object.freeze({
    code: 'ZA',
    names: ['south africa', 'south-africa', 'za', 'rsa'],
    hints: ['johannesburg', 'rustenburg', 'witwatersrand', 'cape town'],
  }),
  Object.freeze({
    code: 'AU',
    names: ['australia', 'au'],
    hints: ['perth', 'pilbara', 'kalgoorlie', 'darwin', 'queensland', 'wa'],
  }),
  Object.freeze({
    code: 'CL',
    names: ['chile', 'cl'],
    hints: ['santiago', 'antofagasta', 'chuquicamata', 'collahuasi'],
  }),
  Object.freeze({
    code: 'ID',
    names: ['indonesia', 'id'],
    hints: ['jakarta', 'sumbawa', 'sulawesi', 'kalimantan', 'papua'],
  }),
  // Unseeded — surfaced so the brain knows to use the graceful
  // fallback instead of pretending it has details.
  Object.freeze({
    code: 'PE',
    names: ['peru', 'pe'],
    hints: ['lima', 'cuzco', 'arequipa'],
  }),
  Object.freeze({
    code: 'GH',
    names: ['ghana', 'gh'],
    hints: ['accra', 'tarkwa', 'obuasi'],
  }),
  Object.freeze({
    code: 'ML',
    names: ['mali', 'ml'],
    hints: ['bamako', 'sadiola'],
  }),
  Object.freeze({
    code: 'CD',
    names: [
      'drc',
      'congo',
      'democratic republic of congo',
      'democratic republic of the congo',
    ],
    hints: ['kinshasa', 'lubumbashi', 'katanga'],
  }),
]);

/**
 * Returns the ISO-3166-1 alpha-2 of the first jurisdiction the
 * message explicitly mentions, or `null` if none.
 *
 * Detection rules (case-insensitive):
 *   1. Country name match preceded by `in / for / from / to /
 *      across / into / our / your` OR followed by a word boundary.
 *   2. Bare alpha-2 only when preceded by `in / for / from / to /
 *      across / our / your` to avoid false positives on common
 *      English words (e.g. "id" inside "didn't").
 *   3. City / region hint anywhere in the message.
 */
export function detectJurisdiction(message: string): string | null {
  if (typeof message !== 'string' || message.trim().length === 0) {
    return null;
  }
  const lower = message.toLowerCase();

  // Pass 1 — full country names. Iterate in TABLE order so TZ wins
  // when a tenant says "Tanzania" before anything else. Detection
  // is FIRST match, so this also handles "Kenya vs Tanzania" with
  // the order they appear in the message because we use indexOf
  // comparison.
  let bestCode: string | null = null;
  let bestPos = Number.POSITIVE_INFINITY;

  for (const entry of COUNTRY_TABLE) {
    for (const name of entry.names) {
      // Skip bare alpha-2 in pass 1; handled in pass 2 with the
      // preposition constraint.
      if (name.length === 2) continue;
      const idx = findWord(lower, name);
      if (idx !== -1 && idx < bestPos) {
        bestPos = idx;
        bestCode = entry.code;
      }
    }
    for (const hint of entry.hints) {
      const idx = findWord(lower, hint);
      if (idx !== -1 && idx < bestPos) {
        bestPos = idx;
        bestCode = entry.code;
      }
    }
  }

  if (bestCode) return bestCode;

  // Pass 2 — alpha-2 codes ONLY when preceded by a directional
  // preposition. Avoids "id" inside "kid" etc.
  const alphaTwoPattern =
    /\b(?:in|for|from|to|across|into|our|your)\s+(tz|ke|ug|ng|za|au|cl|id|pe|gh|ml|cd)\b/i;
  const m = alphaTwoPattern.exec(lower);
  if (m && typeof m[1] === 'string') {
    return m[1].toUpperCase();
  }

  return null;
}

function findWord(haystack: string, needle: string): number {
  if (needle.length === 0) return -1;
  // Word-boundary search. Avoids matching "id" inside "kid".
  const pattern = new RegExp(`\\b${escapeRegExp(needle)}\\b`, 'i');
  const m = pattern.exec(haystack);
  return m ? m.index : -1;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
