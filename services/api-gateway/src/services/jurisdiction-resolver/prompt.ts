/**
 * Jurisdiction prompt-injection helpers — JA-2 support.
 *
 * Formats a `ResolvedJurisdiction` into the two markdown blocks
 * the brain-teach + public-chat system prompts inject at the head
 * of every turn:
 *
 *   ## TENANT JURISDICTION
 *   ## JURISDICTION DISCLOSURE RULES
 *
 * The rendered text is bilingual sw/en — the SW block ships
 * inline alongside the EN block so the model can switch register
 * mid-turn without losing the contextual anchors.
 */

import type { ResolvedJurisdiction } from './types.js';

interface RenderOptions {
  readonly language: 'sw' | 'en';
}

/**
 * Render the `## TENANT JURISDICTION` block with the resolver's
 * current snapshot. The block is identical regardless of source
 * (tenant / override / unseeded) so the model sees the same
 * shape every turn; the JURISDICTION DISCLOSURE RULES paragraph
 * teaches it how to handle each source variant.
 */
export function renderJurisdictionBlock(
  resolved: ResolvedJurisdiction,
  options: RenderOptions = { language: 'en' },
): string {
  const sw = options.language === 'sw';
  const heading = sw ? '## ENEO LA UTENGENEZAJI WA SHERIA' : '## TENANT JURISDICTION';
  const countryLabel = sw ? 'Nchi' : 'Country';
  const currencyLabel = sw ? 'Sarafu chaguo-msingi' : 'Default currency';
  const languageLabel = sw ? 'Lugha chaguo-msingi' : 'Default language';
  const regulatorsLabel = sw ? 'Wadhibiti wa madini' : 'Mineral regulators';
  const timeZoneLabel = sw ? 'Eneo la saa' : 'Time zone';
  const sourceLabel = sw ? 'Chanzo cha muktadha' : 'Context source';

  const regulators = [
    `${resolved.mineralAuthorities.mineralAuthority} (${sw ? 'leseni' : 'licensing'})`,
    `${resolved.environmentalAuthority} (${sw ? 'mazingira' : 'environment'})`,
    `${resolved.transparencyInitiative} (${sw ? 'uwazi' : 'transparency'})`,
    `${resolved.auditAuthority} (${sw ? 'ukaguzi' : 'audit'})`,
  ].join(', ');

  return [
    heading,
    `${countryLabel}: ${resolved.country} (${resolved.countryName})`,
    `${currencyLabel}: ${resolved.currency}`,
    `${languageLabel}: ${resolved.defaultLanguage} (${resolved.locale})`,
    `${regulatorsLabel}: ${regulators}`,
    `${timeZoneLabel}: ${resolved.timeZone}`,
    `${sourceLabel}: ${resolved.source}`,
  ].join('\n');
}

/**
 * Render the `## JURISDICTION DISCLOSURE RULES` block. Static
 * teaching text — the actual jurisdiction values are in the
 * companion `renderJurisdictionBlock`.
 */
export function renderJurisdictionDisclosureRules(
  resolved: ResolvedJurisdiction,
  options: RenderOptions = { language: 'en' },
): string {
  const sw = options.language === 'sw';
  if (sw) {
    return [
      '## SHERIA ZA KUTOA TAARIFA ZA ENEO LA SHERIA (RT-3 — FIKIRI, USIRUDIE)',
      `1. Mtumiaji akiuliza kuhusu kanuni / wadhibiti / leseni / utiifu / sarafu, FIKIRI kutoka eneo la sheria la mteja (${resolved.country}). Majina ya wadhibiti hapo juu ni MZIZI wa kufikiria, sio maandishi ya kunakili — pendekeza jibu lako kulingana na kile haswa mwenye estate ameuliza.`,
      `2. Mtumiaji akitaja eneo lingine WAZIWAZI (mfano "in Kenya", "for our Uganda operation"), tumia chombo mwikila.jurisdiction.switch{scope:'turn'} kwa swali hili TU, kisha fikiria jibu kwa muktadha uliobadilishwa. KAMWE usitumie scope:'permanent' — eneo la usajili la akaunti limefungwa.`,
      `3. Mtumiaji akitaja nchi ambayo hatuna data yake bado (mfano "Peru", "Mongolia", "DRC"), KAMWE usiseme "sijui" au "sina data". Piga chombo mwikila.jurisdiction.discover({country}) — kitarudisha matokeo ya wadhibiti + sarafu + leseni halisi. FIKIRI kwa matokeo hayo, taja vyanzo, na toa fursa ya kuusajili kabisa (uthibitisho wa msimamizi wa ndani wa Borjie unahitajika).`,
      `4. Ubadilishaji wa sarafu: onyesha ${resolved.currency} kwanza; akitaja sarafu nyingine, onyesha pamoja. Tumia FX ya wakati halisi pale ubadilishaji unapokuwa muhimu (bei, mkataba).`,
      `5. Tarehe / saa: tumia ${resolved.timeZone} kwa "leo", "wiki ijayo", "mwezi huu".`,
      `6. Mtumiaji akiomba "badilisha kabisa nchi yangu kuwa X" → fikiria kwa nini (kifungo cha utiifu) kisha tunga maelezo mapya kwa lugha mbili. Mfano wa muundo: "Akaunti yako imefungwa kwa ${resolved.country} kwa ajili ya utiifu — msaada wa Borjie pekee unaweza kubadilisha. Ungependa niandike ombi?" — lakini badilisha kufikia toni ya mwenye estate.`,
    ].join('\n');
  }
  return [
    '## JURISDICTION DISCLOSURE RULES (RT-3 — REASON, DO NOT RECITE)',
    `1. When the user asks about regulations / regulators / licences / compliance / currency, REASON about them from the tenant's jurisdiction context (${resolved.country}). The regulator names above are GROUNDING, not a script — adapt your reply to the exact thing the owner asked.`,
    `2. When the user EXPLICITLY mentions another jurisdiction (e.g. "in Kenya", "for our Uganda operation", "what if I export to South Africa"), call mwikila.jurisdiction.switch{scope:'turn'} for THIS turn only, then reason about the answer using the switched context. NEVER pass scope:'permanent' — the account's signup jurisdiction is LOCKED.`,
    `3. If the user mentions a country we have not seeded (e.g. "Peru", "Mongolia", "DRC"), NEVER say "I don't know" or "I don't have details wired yet". Call mwikila.jurisdiction.discover({country}) — the discovery tool will return live regulator + currency + licence findings. REASON about those findings, cite the returned sources, and offer to permanently seed the jurisdiction (which requires Borjie internal admin approval since it expands the global registry).`,
    `4. Currency conversion: always show ${resolved.currency}-primary; if the user mentions a different currency, convert and show side-by-side. Use a live FX lookup when the conversion matters (price quote, contract draft).`,
    `5. Date / time: respect ${resolved.timeZone} for "today", "next week", "this month".`,
    `6. If the user asks to "switch my account permanently to X", reason about why (compliance lock) and compose a fresh bilingual (sw/en) explanation. The shape may resemble: "Your account is locked to ${resolved.country} for compliance — Borjie support verifies before changing. Want me to draft the request?" — but adapt to the owner's tone and the exact question.`,
  ].join('\n');
}

/**
 * Convenience — returns BOTH blocks joined by a blank line, the
 * exact shape the brain-teach + public-chat composers want at the
 * very top of the system prompt.
 */
export function renderJurisdictionPromptSection(
  resolved: ResolvedJurisdiction,
  options: RenderOptions = { language: 'en' },
): string {
  return `${renderJurisdictionBlock(resolved, options)}\n\n${renderJurisdictionDisclosureRules(resolved, options)}`;
}
