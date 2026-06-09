/**
 * Prompt builder for the tab-schema generator.
 *
 * Composes a deterministic system prompt that pins the LLM to the
 * `PortalTab` JSON schema and explains the available field + widget
 * kinds. Kept in a separate module so the prompt can be diffed in
 * code review and unit-tested independently of the LLM round-trip.
 */

import {
  PORTAL_TAB_FIELD_KINDS,
  PORTAL_TAB_WIDGET_KINDS,
  type GeneratorOrgContext,
  type PortalLocale,
  type TabGenerationIntent,
} from '../types.js';
import { FIELD_KIND_REGISTRY } from '../fields/registry.js';
import { WIDGET_KIND_REGISTRY } from '../widgets/registry.js';

function renderFieldCatalog(): string {
  return PORTAL_TAB_FIELD_KINDS.map((kind) => {
    const meta = FIELD_KIND_REGISTRY[kind];
    return `  - "${kind}" — ${meta.displayLabel}: ${meta.description}`;
  }).join('\n');
}

function renderWidgetCatalog(): string {
  return PORTAL_TAB_WIDGET_KINDS.map((kind) => {
    const meta = WIDGET_KIND_REGISTRY[kind];
    return `  - "${kind}" — ${meta.displayLabel}: ${meta.description}`;
  }).join('\n');
}

const STATIC_PROMPT_HEAD = `You design a tab for a multi-tenant mining-estate portal.

Output STRICT JSON with the shape (Zod schema: PortalTab):

{
  "id": "<placeholder; the caller will overwrite>",
  "version": 1,
  "tenantId": "<placeholder>",
  "userId": null,
  "tabKey": "<lowercased.dot.separated.key>",
  "title": "<concise title>",
  "description": "<one-sentence explanation>",
  "icon": "<lucide-react icon name>",
  "domain": "<hr|finance|compliance|procurement|operations|sales|marketing|engineering|legal|sustainability|custom>",
  "sections": [
    {
      "key": "<lowercased_key>",
      "title": "<section title>",
      "description": "<optional>",
      "fields": [
        {
          "key": "<lowercased_key>",
          "label": "<label>",
          "kind": "<one of the field kinds>",
          "required": true|false,
          "options": [{"value": "...", "label": "..."}]  // only for dropdown / multi_select
          ...other kind-specific props
        }
      ],
      "widgets": [
        {
          "key": "<lowercased_key>",
          "kind": "<one of the widget kinds>",
          "title": "<widget title>",
          "span": 6,
          "config": { ... }
        }
      ]
    }
  ],
  "permissions": {
    "visibleToPersonas": ["internal_admin", ...],
    "ownerOnlyEdits": false
  },
  "audit": {
    "createdBy": "system",
    "updatedBy": "system",
    "history": []
  },
  "createdAt": "<ISO-8601>",
  "updatedAt": "<ISO-8601>"
}

HARD RULES:
  - Use ONLY the field kinds and widget kinds listed below.
  - Output JSON ONLY. NO prose. NO markdown fences.
  - Between 1 and 4 sections. Each section ≥ 1 field OR ≥ 1 widget.
  - Field keys / section keys / widget keys are lowercase, snake_case
    or dot.separated, ≤ 120 chars, unique within the tab.
  - tabKey starts with the domain, e.g. "hr.payroll", "finance.budgets".
  - For "currency" fields use an ISO 4217 currencyCode when the org's
    currency is known; else omit and the renderer falls back.
  - For "dropdown" / "multi_select" populate ≥ 2 sensible options.
  - "permissions.visibleToPersonas" is required, ≥ 1 persona.
  - Prefer wide-coverage sections that map to the user's intent.
    For HR: People, Payroll, Time off, Performance.
    For Finance: Budget, Expenses, Invoices, Forecasts.
    For Compliance: Controls, Evidence, Incidents, Audits.
    For Procurement: Suppliers, POs, Contracts, Onboarding.

FIELD KINDS:
{{FIELDS}}

WIDGET KINDS:
{{WIDGETS}}`;

/**
 * Render the ABSOLUTE single-language directive for the generation
 * system prompt. Mirrors the brain `/turn` orchestrator directive
 * (`renderOrchestratorLanguageDirective` in central-intelligence
 * `kernel.ts`): CLAUDE.md mandate is `en` default, `sw` toggle, ZERO
 * mixing. The brain is bilingual — it AUTHORS every label in the
 * target language; it does NOT translate or look up a dictionary.
 *
 * The directive copy itself is written in the target language so the
 * model is anchored by example and never mixes the two. It enumerates
 * EVERY generated string surface (title, description, section titles,
 * field labels, options, help, widget titles) because those are the
 * only human-visible strings on a generated tab — system keys
 * (tabKey, field keys, kinds, icons) stay machine-stable regardless of
 * locale.
 */
export function renderGenerationLanguageDirective(
  locale: PortalLocale,
): string {
  if (locale === 'sw') {
    return [
      '# LUGHA YA LEBO (LAZIMA)',
      'Andika MANENO YOTE yanayoonekana kwa Kiswahili PEKEE: kichwa cha',
      'tab (title), maelezo (description), vichwa vya sehemu (section',
      'titles), lebo za sehemu za kujaza (field labels), chaguo (options),',
      'maelezo ya msaada (help), na vichwa vya wijeti (widget titles).',
      'USICHANGANYE Kiingereza na Kiswahili popote. Funguo za mfumo —',
      'tabKey, funguo za sehemu (keys), aina (kinds), na ikoni — zibaki',
      'kama zilivyo (hazitafsiriwi).',
    ].join('\n');
  }
  return [
    '# LABEL LANGUAGE (REQUIRED)',
    'Write EVERY human-visible string in English ONLY: the tab title,',
    'description, section titles, field labels, dropdown option labels,',
    'help text, and widget titles. Never mix Swahili and English',
    'anywhere. System keys — tabKey, section/field/widget keys, kinds,',
    'and icon names — stay as-is (they are machine identifiers, never',
    'translated).',
  ].join('\n');
}

const STATIC_PROMPT_TAIL = `INTENT EVIDENCE:
{{EVIDENCE}}

ORG CONTEXT:
{{ORG_CONTEXT}}

USER MESSAGE THAT TRIGGERED THIS:
"""{{SOURCE_MESSAGE}}"""

PROPOSED TAB:
  tabKey: {{PROPOSED_KEY}}
  title: {{PROPOSED_TITLE}}
  domain: {{DOMAIN}}

OWNER ACTIVE LOCALE: {{LOCALE}}
{{LOCALE_REMINDER}}

Return the JSON now.`;

export interface BuildPromptArgs {
  readonly intent: TabGenerationIntent;
  readonly orgContext: GeneratorOrgContext | undefined;
  /** Owner's active locale. Defaults to `en` (CLAUDE.md) when omitted. */
  readonly locale?: PortalLocale;
}

/**
 * Build the generation system prompt. The absolute single-language
 * directive is appended LAST so it is the terminal instruction the
 * model reads — it cannot be displaced by the field/widget catalogs
 * that precede it (same ordering discipline as the brain orchestrator's
 * locale-last layering). Defaults to `en` per CLAUDE.md.
 */
export function buildGenerationSystemPrompt(
  locale: PortalLocale = 'en',
): string {
  const base = STATIC_PROMPT_HEAD.replace(
    '{{FIELDS}}',
    renderFieldCatalog(),
  ).replace('{{WIDGETS}}', renderWidgetCatalog());
  return `${base}\n\n${renderGenerationLanguageDirective(locale)}`;
}

export function buildGenerationUserMessage(args: BuildPromptArgs): string {
  const { intent, orgContext } = args;
  const locale: PortalLocale = args.locale ?? intent.locale ?? 'en';
  const evidence =
    intent.evidence.length > 0
      ? intent.evidence.map((e) => `  - "${e}"`).join('\n')
      : '  (none)';
  const orgLines: string[] = [];
  if (orgContext?.tenantName) {
    orgLines.push(`  - tenantName: ${orgContext.tenantName}`);
  }
  if (orgContext?.tenantRegion) {
    orgLines.push(`  - tenantRegion: ${orgContext.tenantRegion}`);
  }
  if (orgContext?.tenantCurrency) {
    orgLines.push(`  - tenantCurrency: ${orgContext.tenantCurrency}`);
  }
  if (orgContext?.userPersona) {
    orgLines.push(`  - userPersona: ${orgContext.userPersona}`);
  }
  if (orgContext?.existingTabKeys && orgContext.existingTabKeys.length > 0) {
    orgLines.push(
      `  - existingTabKeys: ${orgContext.existingTabKeys.join(', ')}`,
    );
  }
  // The proposed title is a machine-derived HINT (often English from the
  // heuristic detector) — the brain must (re)author it in the owner's
  // locale rather than echo it verbatim, so a `sw` owner never inherits an
  // English title. The reminder is written in the target language.
  const localeReminder =
    locale === 'sw'
      ? 'KUMBUSHO: kichwa kilichopendekezwa hapo juu ni dokezo tu — andika title, vichwa, na lebo ZOTE kwa Kiswahili.'
      : 'REMINDER: the proposed title above is only a hint — write the title, section titles, and all labels in English.';

  return STATIC_PROMPT_TAIL.replace('{{EVIDENCE}}', evidence)
    .replace(
      '{{ORG_CONTEXT}}',
      orgLines.length > 0 ? orgLines.join('\n') : '  (none)',
    )
    .replace('{{SOURCE_MESSAGE}}', intent.sourceMessage)
    .replace('{{PROPOSED_KEY}}', intent.proposedTabKey)
    .replace('{{PROPOSED_TITLE}}', intent.proposedTabTitle)
    .replace('{{DOMAIN}}', intent.domain)
    .replace('{{LOCALE}}', locale)
    .replace('{{LOCALE_REMINDER}}', localeReminder);
}
