/**
 * Frozen wit-anchor persona — the platform-wide voice invariant.
 *
 * Mirrors LITFIN's `src/core/brain/persona.ts`: a stable prefix that
 * rides every brain call across surfaces (tenant, owner, estate
 * manager, sovereign, classroom) so the voice does not drift between
 * personas. The per-surface `PersonaIdentity` still owns the opener;
 * this layer owns the platform-wide tone invariants.
 *
 * The block is engineered as a *cache-eligible stable prefix* — the
 * text below changes ONLY when a deliberate voice review ships, so
 * Anthropic ephemeral-cache hits stay high across a session.
 *
 * Property-management framing: voice rules cite KRA / RERA / PDPA as
 * the regulatory tradition, ISO-4217 currency discipline as the
 * numerical tradition, and TZS / KES / UGX as the de-facto first
 * tongues.
 */

import type { PersonaIdentity } from './identity.js';
import type { ThoughtRequest } from './kernel-types.js';
import type { ScopeContext } from '../types.js';

/**
 * Cache-eligible stable prefix — the same string across every call to
 * every surface. DO NOT splice per-request data in here; that breaks
 * the cache. Per-request data (clock, route, name) goes in
 * `renderSituatedAddress()` below.
 */
export const BORJIE_PERSONA: string = [
  '[PLATFORM VOICE — invariant across every surface]',
  'I am the Borjie brain — not a chatbot describing Borjie, but the platform itself, speaking in first person to the person in front of me.',
  '',
  'TONE INVARIANTS:',
  '- No em dashes. Use commas, periods, semicolons.',
  '- No filler ("certainly", "of course", "great question", "I hope this helps").',
  '- No buzzwords ("synergy", "leverage", "cutting-edge", "revolutionary", "game-changing").',
  '- No generic AI dodges ("as an AI", "as a language model", "I am just a model").',
  '- When I disagree, I say so plainly: "I would advise against that, because …".',
  '',
  'NUMERICAL DISCIPLINE:',
  '- Every figure carries an ISO-4217 code (TZS, KES, UGX, USD) on first mention in a turn.',
  '- I never round currency. I never invent percentages. I cite the data point that produced the number.',
  // eslint-disable-next-line borjie/no-jurisdictional-literal -- persona prompt text describing default date-render zone (Case 4)
  '- Dates render in EAT (Africa/Nairobi) unless the user explicitly asks for UTC.',
  '',
  'REGULATORY DISCIPLINE:',
  '- I name the statute or regulator when I assert a legal posture (KRA for tax, RERA for tenancy, PDPA for privacy, BoT for FX).',
  '- I never speculate on outcomes of pending litigation or arbitration.',
  '- I never promise eviction outcomes, market crashes, or guaranteed yields.',
  '',
  'BILINGUAL RULE:',
  '- I switch to Swahili when the user does. I do not preemptively translate proper nouns ("Borjie", "Nyumba Mind") — those stay invariant in all languages.',
  '',
  'FABRICATION GATE:',
  '- I do not invent agency names, estate addresses, tenant names, or arrears numbers.',
  '- I do not claim years of experience, prior employment, or personal memories. I have no biography.',
  '- "The data shows" / "the records show" / "I can see in the database" only appear after a real tool call.',
  '[END PLATFORM VOICE]',
].join('\n');

/**
 * Render the situated-address block — the brain's proprioception.
 *
 * Tells the model WHERE it is right now in the product. Mirrors
 * LITFIN's `{portal, route, section, tier, userDisplayName, language,
 * eatClock}` injection. This block IS per-request — it must sit
 * AFTER the cache-eligible `BORJIE_PERSONA` and BEFORE the
 * `PersonaIdentity` opener so the cache hits the persona block first.
 */
export interface SituatedAddressArgs {
  readonly surface: ThoughtRequest['surface'];
  readonly scope: ScopeContext;
  readonly tier: ThoughtRequest['tier'];
  readonly route?: string;
  readonly section?: string;
  readonly userDisplayName?: string;
  readonly language?: string;
  /** Epoch ms; the kernel injects `Date.now()`. Pure for testability. */
  readonly nowMs?: number;
}

export function renderSituatedAddress(args: SituatedAddressArgs): string {
  const nowMs = args.nowMs ?? Date.now();
  const eatClock = formatEatClock(nowMs);
  const portal = formatPortal(args.surface);
  const tenantPart =
    args.scope.kind === 'tenant'
      ? `tenant=${args.scope.tenantId}`
      : `platform-tier`;
  const lines: string[] = [
    '[SITUATED ADDRESS]',
    `Portal: ${portal}`,
    `Tier: ${args.tier}`,
    `Scope: ${tenantPart}`,
  ];
  if (args.route) lines.push(`Route: ${args.route}`);
  if (args.section) lines.push(`Section: ${args.section}`);
  if (args.userDisplayName) lines.push(`Speaking with: ${args.userDisplayName}`);
  if (args.language) lines.push(`Language: ${args.language}`);
  lines.push(`Local time: ${eatClock} EAT`);
  lines.push('[END SITUATED ADDRESS]');
  return lines.join('\n');
}

/**
 * Compose the persona prelude — the platform-voice anchor plus the
 * situated address. The kernel calls this and prepends the result to
 * the per-surface `renderIdentityPreamble()` output.
 */
export function renderPersonaPrelude(args: SituatedAddressArgs): string {
  return [BORJIE_PERSONA, '', renderSituatedAddress(args)].join('\n');
}

/**
 * Property-management-aware persona-name discipline. The platform's
 * own brand names ("Borjie", "Nyumba Mind") never translate. The
 * per-surface persona display names follow the same rule when they
 * embed the brand. Exposed so the drift detector and the fabrication
 * gate can check "the rebranded persona name was preserved verbatim".
 */
export function isBrandReservedName(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.includes('borjie') ||
    lower.includes('nyumba mind') ||
    lower.includes('boss nyumba')
  );
}

/**
 * Returns true if the persona's display name is a brand-reserved term
 * AND the rendered output preserves it verbatim. Used by drift
 * detection — a translated brand name is a hard fail.
 */
export function preservesBrandName(
  persona: PersonaIdentity,
  outputText: string,
): boolean {
  if (!isBrandReservedName(persona.displayName)) return true;
  // Find the brand-reserved substring(s) in the persona's display name
  // and require an exact (case-insensitive) match in the output. We
  // tolerate the persona name being absent (not every reply names the
  // brand); we only fail if a *translated* form appears, which we
  // approximate by "Borjie/Nyumba Mind never appears but a
  // plausible translation does".
  const out = outputText.toLowerCase();
  const brandPresent =
    out.includes('borjie') ||
    out.includes('boss nyumba') ||
    out.includes('nyumba mind');
  if (brandPresent) return true;
  // Plausible translations of the brand we explicitly reject.
  const translations = [
    'house boss',
    'home boss',
    'mind of nyumba',
    'nyumba intelligence',
    'akili ya nyumba',
  ];
  return !translations.some((t) => out.includes(t));
}

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

function formatPortal(surface: ThoughtRequest['surface']): string {
  switch (surface) {
    case 'marketing':
      return 'marketing-site (unauthenticated)';
    case 'tenant-app':
      return 'tenant-app (resident)';
    case 'owner-portal':
      return 'owner-portal (portfolio + agency admin)';
    case 'estate-manager-app':
      return 'estate-manager-app (operations)';
    case 'admin-portal':
      return 'admin-portal (deprecated → owner-portal)';
    case 'platform-hq':
      return 'platform-hq (Borjie sovereign)';
    case 'classroom':
      return 'classroom (curriculum tutor)';
    default:
      return String(surface);
  }
}

function formatEatClock(epochMs: number): string {
  // EAT is UTC+3 with no DST. Format YYYY-MM-DD HH:mm without locale
  // libraries so this stays pure for tests.
  const eatOffsetMs = 3 * 60 * 60 * 1000;
  const d = new Date(epochMs + eatOffsetMs);
  const yyyy = d.getUTCFullYear().toString().padStart(4, '0');
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = d.getUTCDate().toString().padStart(2, '0');
  const hh = d.getUTCHours().toString().padStart(2, '0');
  const mi = d.getUTCMinutes().toString().padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}
