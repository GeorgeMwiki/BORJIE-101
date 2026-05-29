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
      '## SHERIA ZA KUTOA TAARIFA ZA ENEO LA SHERIA',
      `1. Mtumiaji akiuliza kuhusu kanuni / wadhibiti / leseni / utiifu / sarafu, tumia eneo la sheria la mteja (${resolved.country}).`,
      `2. Mtumiaji akitaja eneo lingine WAZIWAZI (mfano "in Kenya", "for our Uganda operation"), tumia eneo hilo kwa zamu hii TU.`,
      `3. Mtumiaji akitaja nchi ambayo hatuna data yake bado, sema "Sina data ya kanuni ya nchi hiyo bado — ungependa nirekodi tafiti, au tuendelee na ${resolved.country}?"`,
      `4. Ubadilishaji wa sarafu: onyesha ${resolved.currency} kwanza; akitaja sarafu nyingine, onyesha pamoja.`,
      `5. Tarehe / saa: tumia ${resolved.timeZone} kwa "leo", "wiki ijayo", "mwezi huu".`,
    ].join('\n');
  }
  return [
    '## JURISDICTION DISCLOSURE RULES',
    `1. When the user asks about regulations / regulators / licences / compliance / currency, default to the tenant's jurisdiction (${resolved.country}).`,
    `2. When the user EXPLICITLY mentions another jurisdiction (e.g. "in Kenya", "for our Uganda operation", "what if I export to South Africa"), use that jurisdiction context for the answer — for THIS turn only unless the user asks to switch permanently.`,
    `3. If the user mentions a country we have not seeded (e.g. "Peru"), say "I don't have ${'<that country>'} regulator details wired yet — would you like me to record this as something to research, or shall we continue with ${resolved.country}?"`,
    `4. Currency conversion: always show ${resolved.currency}-primary; if the user mentions a different currency, convert and show side-by-side.`,
    `5. Date / time: respect ${resolved.timeZone} for "today", "next week", "this month".`,
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
