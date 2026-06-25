/**
 * WIRE-I18N GATE — the backend "no mixed-bilingual / no property-vocab on
 * the wire" detector.
 *
 * THE LAW (CLAUDE.md + the language-engineering canon):
 *   - THE WIRE IS LOCALE-NEUTRAL. Backend route handlers emit a STABLE
 *     UPPER_SNAKE `code`; when human prose must ride the wire it rides as
 *     a STRUCTURED `{ en, sw }` pair so the FE picks the active locale and
 *     renders exactly ONE language (the `routes/marketplace/rfb.hono.ts`
 *     precedent the buyer/owner surfaces already consume via
 *     `isSw ? x.sw : x.en`).
 *   - A SINGLE client-facing string literal that carries BOTH an English
 *     word AND a Swahili marker word is a MIXED-BILINGUAL string: it mixes
 *     on whatever surface renders it (e.g. the seller toast) regardless of
 *     the active locale. This is the canonical defect this gate exists to
 *     stop (bids.hono.ts once emitted
 *     `'Bid is no longer pending. Zabuni hii haisubiri tena.'`).
 *   - A mining estate carries ZERO property-domain residue. Off-mandate
 *     property vocabulary (rent / lease / service-charge / sinking-fund /
 *     per-unit / Mpangaji …) in a CLIENT-FACING literal is D24 residue.
 *
 * SCOPE: every `.ts` under `services/api-gateway/src/routes/**` (the
 * client-facing emission surface). The gate scans the SOURCE TEXT — it does
 * not import the routes (no DB, no boot) — so it runs as a fast unit test.
 *
 * PRECISION: `${...}` interpolation and UPPER_SNAKE codes are STRIPPED
 * before matching so a stable `code` / an interpolated id never trips the
 * gate. Only SINGLE-LINE string literals are considered (multi-line
 * template blocks are persona/prompt scaffolds that are locale-pinned by
 * SECTION, not mixed-in-one-string). Property-vocab matching deliberately
 * EXCLUDES the multi-tenancy CORE term (`tenant_id`, `tenant:<id>`,
 * `tenants` table) — only the property-SENSE of `tenant` (adjacent to
 * rent / lease / unit / landlord / occupancy) is flagged.
 *
 * RATCHET: the allowlist below can only SHRINK. Each entry is a
 * genuinely-neutral string with a reason. A new offender is a RED test
 * until it is either fixed (convert to `{ en, sw }` / rely on the code) or,
 * if genuinely neutral, allowlisted WITH a reason.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

// This module is compiled to CommonJS (tsup), so `__dirname` is the
// portable way to resolve the routes directory — `import.meta.url` is
// rejected by the CJS-targeted compile.
export const ROUTES_DIR = join(__dirname, 'routes');

export interface WireOffender {
  /** Path relative to `src/`, e.g. `routes/mining/bids.hono.ts`. */
  readonly file: string;
  readonly line: number;
  readonly kind: 'mixed-bilingual' | 'property-vocab';
  /** The raw literal (interpolation intact) for the report. */
  readonly literal: string;
  /** A stable key `file:line` used by the allowlist. */
  readonly id: string;
}

/**
 * THE ALLOWLIST — genuinely locale-neutral strings only, each with a
 * reason. It can only SHRINK: removing the offender (fix or delete the
 * string) is always preferred over adding a line here.
 */
export const WIRE_I18N_ALLOWLIST: ReadonlyMap<string, string> = new Map([
  [
    'routes/health-dependencies.router.ts:182',
    'Internal ops/health-dependency registry `note` (operator-facing, never ' +
      'a tenant locale render). "Monthly Rental Income" is the OFFICIAL ' +
      'TZ/KRA tax-return name — a genuine government tax-regime label, not ' +
      'property-domain residue.',
  ],
]);

// Swahili MARKER words — high-signal, whole-word. Chosen so a stray shared
// token cannot trip the gate alone (the gate requires a STRONG marker, not
// a bare conjunction).
const SW_MARKERS: ReadonlySet<string> = new Set([
  'haisubiri', 'haijapatikana', 'haijapata', 'imeshindwa', 'tumeshindwa',
  'imeshafungwa', 'imefungwa', 'haijafunguliwa', 'imekwisha', 'imeshapata',
  'muktadha', 'haiwezi', 'kupeleka', 'kupelekwa', 'kufikisha', 'kuunda',
  'kutuma', 'kusaini', 'kukubali', 'jibu', 'halipatikani', 'lazima',
  'tena', 'wako', 'wake', 'habari', 'karibu', 'asante', 'zabuni', 'muda',
  'tarehe', 'iwe', 'sawa', 'haijakamilika', 'wapangaji', 'mpangaji',
  'kodi', 'soko', 'tafadhali', 'jaribu', 'hakuna', 'samahani', 'haipo',
  'mkataba', 'ununuzi', 'kabla', 'rasilimali', 'hujapata',
]);

// English MARKER words — common in route error/message prose.
const EN_MARKERS: ReadonlySet<string> = new Set([
  'the', 'not', 'found', 'failed', 'create', 'send', 'your', 'please',
  'try', 'again', 'already', 'closed', 'open', 'expired', 'must',
  'available', 'temporarily', 'could', 'cannot', 'agreement', 'pending',
  'longer', 'sign', 'bid', 'request', 'response', 'date', 'future',
  'this', 'invalid', 'required', 'complete', 'before', 'unavailable',
]);

// Off-mandate property vocabulary (D24) — the UNAMBIGUOUS property tokens
// that have no mining-domain meaning, flagged STANDALONE.
const PROPERTY_VOCAB =
  /\b(rent|rental|lease|leasehold|service[\s-]?charge|sinking[\s-]?fund|mpangaji|wapangaji)\b/i;
// AMBIGUOUS tokens that ALSO carry a legitimate mining meaning, flagged
// ONLY in a property CONTEXT (co-occurring with a clear property word) so
// the mining senses are not false-positives:
//   - `tenant` is the multi-tenancy CORE term (excludes `tenant_id` /
//     `tenant:<id>`); only the rental-tenant sense is residue.
//   - `per-unit` in mining = per-equipment-unit / per-output-unit (a
//     fleet "per-unit cycle time", a "per-unit cost"); the property sense
//     is per-rental-unit.
const TENANT_WORD = /\btenants?\b(?![_:])/i;
const PER_UNIT_WORD = /\bper[\s-]?unit\b/i;
const PROPERTY_CONTEXT =
  /\b(rent|lease|leasehold|service[\s-]?charge|sinking[\s-]?fund|landlord|occupan|apartment|dwelling|mpangaji)/i;

/** Strip `${...}` interpolation + UPPER_SNAKE codes so they never trip the gate. */
function stripNoise(s: string): string {
  return s
    .replace(/\$\{[^}]*\}/g, ' ')
    .replace(/\b[A-Z][A-Z0-9_]{2,}\b/g, ' ');
}

function tokens(s: string): string[] {
  return (s.toLowerCase().match(/[a-z']+/g) ?? []).filter((w) => w.length > 1);
}

interface RawLiteral {
  readonly raw: string;
  readonly index: number;
}

/**
 * Blank out `//` line comments and `/* *\/` block comments, REPLACING each
 * stripped character with a space so byte offsets (and therefore line
 * numbers) are preserved. Comments are documentation — they never reach the
 * wire — so quoted prose inside a JSDoc header ("I want N tonnes … per unit
 * …") must NOT be mistaken for a client-facing literal. A naive strip would
 * also blank quotes that live INSIDE string literals, so this walks the
 * source as a tiny state machine that knows when it is inside a string.
 */
function blankComments(src: string): string {
  const out = src.split('');
  let i = 0;
  const n = src.length;
  let inString: string | null = null; // the active quote char, or null
  while (i < n) {
    const ch = src[i];
    if (inString) {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === inString) inString = null;
      i++;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      inString = ch;
      i++;
      continue;
    }
    if (ch === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') {
        out[i] = ' ';
        i++;
      }
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      out[i] = ' ';
      out[i + 1] = ' ';
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] !== '\n') out[i] = ' ';
        i++;
      }
      if (i < n) {
        out[i] = ' ';
        out[i + 1] = ' ';
        i += 2;
      }
      continue;
    }
    i++;
  }
  return out.join('');
}

/**
 * Extract SINGLE-LINE string literals (single / double / backtick) from
 * source, after blanking comments. A literal containing a newline (a
 * multi-line template block) is skipped — those are prompt / comment
 * scaffolds, locale-pinned by section, not mixed-in-one-string.
 */
function singleLineLiterals(src: string): RawLiteral[] {
  const code = blankComments(src);
  const out: RawLiteral[] = [];
  // The `(?!\1)[^\\\n]` clause forbids a newline inside the literal body.
  const re = /(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    out.push({ raw: m[2] ?? '', index: m.index });
  }
  return out;
}

function lineOf(src: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (src[i] === '\n') line++;
  return line;
}

/** Does this literal read as client-facing prose (a sentence, not a token)? */
function isProse(raw: string): boolean {
  const s = stripNoise(raw).trim();
  if (!/\s/.test(s)) return false; // single token -> not prose
  if (/^https?:|^\/|::|^\{|@|\.[a-z]{2,4}$/.test(s)) return false; // url/path/id
  return tokens(s).length >= 2 && /[a-z]{3,}/i.test(s);
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (
      p.endsWith('.ts') &&
      !p.endsWith('.d.ts') &&
      !p.endsWith('.test.ts')
    ) {
      out.push(p);
    }
  }
  return out;
}

/**
 * Scan the routes tree and return every offender (allowlisted ones
 * EXCLUDED). Pass `{ includeAllowlisted: true }` to get the raw set
 * (used to detect stale allowlist entries).
 */
export function scanWireI18n(
  opts: { includeAllowlisted?: boolean; routesDir?: string } = {},
): WireOffender[] {
  const routesDir = opts.routesDir ?? ROUTES_DIR;
  const srcRoot = dirname(routesDir);
  const offenders: WireOffender[] = [];

  for (const file of walk(routesDir)) {
    const src = readFileSync(file, 'utf8');
    const rel = relative(srcRoot, file);
    for (const { raw, index } of singleLineLiterals(src)) {
      if (!isProse(raw)) continue;
      const stripped = stripNoise(raw);
      const ws = tokens(stripped);

      // (a) MIXED-BILINGUAL: one literal with BOTH a strong SW marker and
      // an EN marker.
      const hasSw = ws.some((w) => SW_MARKERS.has(w));
      const hasEn = ws.some((w) => EN_MARKERS.has(w));
      if (hasSw && hasEn) {
        const line = lineOf(src, index);
        const id = `${rel}:${line}`;
        if (opts.includeAllowlisted || !WIRE_I18N_ALLOWLIST.has(id)) {
          offenders.push({
            file: rel,
            line,
            kind: 'mixed-bilingual',
            literal: raw,
            id,
          });
        }
      }

      // (b) PROPERTY-VOCAB on a client-facing literal. Unambiguous tokens
      // are flagged standalone; the ambiguous `tenant` / `per-unit` tokens
      // only in a clear property context.
      const isProperty =
        PROPERTY_VOCAB.test(stripped) ||
        ((TENANT_WORD.test(stripped) || PER_UNIT_WORD.test(stripped)) &&
          PROPERTY_CONTEXT.test(stripped));
      if (isProperty) {
        const line = lineOf(src, index);
        const id = `${rel}:${line}`;
        if (opts.includeAllowlisted || !WIRE_I18N_ALLOWLIST.has(id)) {
          offenders.push({
            file: rel,
            line,
            kind: 'property-vocab',
            literal: raw,
            id,
          });
        }
      }
    }
  }
  return offenders;
}

/** Allowlist ids that no longer match any literal (stale → should be removed). */
export function staleAllowlistIds(routesDir?: string): string[] {
  const all = scanWireI18n(
    routesDir === undefined
      ? { includeAllowlisted: true }
      : { includeAllowlisted: true, routesDir },
  );
  const live = new Set(all.map((o) => o.id));
  return [...WIRE_I18N_ALLOWLIST.keys()].filter((id) => !live.has(id));
}

/** Pretty one-line report for a failing test. */
export function formatOffender(o: WireOffender): string {
  return `[${o.kind}] ${o.id}  ${JSON.stringify(o.literal).slice(0, 140)}`;
}
