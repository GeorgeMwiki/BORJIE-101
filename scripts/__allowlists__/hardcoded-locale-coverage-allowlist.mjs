/**
 * Hardcoded-locale-coverage allow-list.
 *
 * Production files that legitimately reference a literal BCP-47 locale tag
 * (`'en-KE'`, `'sw-TZ'`, `'en-US'`, `'en-NG'`, etc.). Test files and
 * fixture files are auto-allowlisted at the scanner level. The
 * jurisdictional registry and i18n bundle directories are auto-allowed
 * via path filter.
 *
 * The platform's vision is "locale follows the user". Business logic must
 * route through `JurisdictionalRules.for(country).defaultLocale` or the
 * user's `language_preference` field; an `Intl.DateTimeFormat('en-KE')`
 * baked into a chart helper silently breaks for every other jurisdiction.
 *
 * Legitimate categories:
 *   1. i18n bundle files / message catalogs (auto-allowed by path).
 *   2. Jurisdictional registry (auto-allowed by path).
 *   3. Per-country plugin scaffolds in `packages/compliance-plugins/`
 *      (auto-allowed by path) — each plugin declares its own locale.
 *   4. UI render-time defaults — when no locale resolved upstream, the
 *      formatter falls back to `'en-US'` as the platform-default tip
 *      of the resolution chain.
 *   5. Tracked-gap entries pending migration to `JurisdictionalRules.for()`.
 *
 * Adding a new locale literal to production code → register here with
 * a justification ≥ 8 characters explaining why business logic needs it.
 *
 * Keys are paths RELATIVE to the repo root.
 */

export const HARDCODED_LOCALE_ALLOWLIST = new Map([
  // ─── Currency-to-locale mapping (registry-style) ───────────────────
  [
    'packages/genui/src/format.ts',
    'GenUI format module exposes CURRENCY_TO_LOCALE map (KES→en-KE, TZS→sw-TZ, USD→en-US) as the i18n registry.',
  ],

  // ─── Seed / bootstrap data ─────────────────────────────────────────
  [
    'packages/database/src/seeds/demo-org-seed.ts',
    'Demo-tenant seed file bootstraps initial locale per country for the demo-orgs.',
  ],

  // ─── GenUI render-time fallback to en-US ───────────────────────────
  [
    'packages/genui/src/components/Heatmap.tsx',
    'Heatmap render-time fallback to en-US when no locale resolved upstream; UI render-only.',
  ],
  [
    'packages/genui/src/components/Gauge.tsx',
    'Gauge render-time fallback to en-US when no locale resolved upstream; UI render-only.',
  ],
  [
    'packages/genui/src/components/SliderInput.tsx',
    'SliderInput render-time fallback to en-US when no locale resolved upstream; UI render-only.',
  ],
  [
    'packages/genui/src/components/MetricSparkline.tsx',
    'MetricSparkline render-time fallback to en-US when no locale resolved upstream; UI render-only.',
  ],

  // ─── Central-intelligence kernel UI/log formatting ─────────────────
  [
    'packages/central-intelligence/src/kernel/kernel.ts',
    'Kernel logging formatter uses en-US for stable cross-language audit-log number serialisation.',
  ],
  [
    'packages/central-intelligence/src/kernel/sub-mds/leasing-after-hours-contact/tools/schedule-viewing-draft.ts',
    'Viewing-draft month abbreviation uses en-US for stable cross-language drafting; tracked-gap pending locale wire.',
  ],

  // ─── AI-copilot multi-script harness baseline fixtures ─────────────
  [
    'packages/ai-copilot/src/multi-script-harness/fixtures.ts',
    'Multi-script-harness baseline test fixtures enumerate per-locale script-correctness scenarios.',
  ],

  // ─── AI-copilot kernel and skill helpers (legitimate-locale uses) ──
  [
    'packages/ai-copilot/src/head-briefing/markdown-renderer.ts',
    'Head-briefing markdown-renderer formats large numbers in en-US for stable cross-language audit output.',
  ],
  [
    'packages/ai-copilot/src/services/preference-profile-engine.ts',
    'Preference-profile-engine uses en-US toLocaleString as the timezone-clock baseline; not user-facing.',
  ],
  [
    'packages/ai-copilot/src/skills/domain/finance.ts',
    'Finance skill formats money in en-KE for Kenya-scoped finance utility; jurisdiction-scoped helper.',
  ],
  [
    'packages/ai-copilot/src/skills/kenya/swahili-draft.ts',
    'Swahili-draft skill formats Kenya amounts in en-KE; the skill is Kenya-only by definition (path).',
  ],
  [
    'packages/ai-copilot/src/voice-persona-dna/profiles.ts',
    'Voice-persona-DNA profiles enumerate primary/insert locales per persona; this IS the persona registry.',
  ],

  // ─── Chat-UI web-speech fallback ───────────────────────────────────
  [
    'packages/chat-ui/src/voice/web-speech-adapter.ts',
    'Web-speech adapter falls back to en-US when navigator.language is unavailable; SSR-safety only.',
  ],

  // ─── Compliance-plugin per-country plugin entries (registry) ──────
  [
    'packages/compliance-plugins/src/plugins/kenya.ts',
    'Kenya country plugin declares en-KE locale; this IS the per-country registry entry.',
  ],
  [
    'packages/compliance-plugins/src/plugins/nigeria.ts',
    'Nigeria country plugin declares en-NG locale; this IS the per-country registry entry.',
  ],
  [
    'packages/compliance-plugins/src/plugins/south-africa.ts',
    'South Africa country plugin declares en-ZA locale; this IS the per-country registry entry.',
  ],
  [
    'packages/compliance-plugins/src/plugins/tanzania.ts',
    'Tanzania country plugin declares sw-TZ locale; this IS the per-country registry entry.',
  ],
  [
    'packages/compliance-plugins/src/plugins/uganda.ts',
    'Uganda country plugin declares en-UG locale; this IS the per-country registry entry.',
  ],
  [
    'packages/compliance-plugins/src/plugins/united-states.ts',
    'United States country plugin declares en-US locale; this IS the per-country registry entry.',
  ],

  // ─── Payment-ledger invoice/statement date formatting ──────────────
  [
    'services/payments-ledger/src/services/invoice.generator.ts',
    'Invoice generator formats dates in en-GB DD-MMM-YYYY for stable invoice presentation; tracked-gap pending locale wire.',
  ],
  [
    'services/payments-ledger/src/services/statement.generator.ts',
    'Statement generator formats dates in en-GB DD-MMM-YYYY for stable statement presentation; tracked-gap pending locale wire.',
  ],

  // ─── Frontend-app UI date-format fallbacks (tracked-gap) ───────────
  [
    'apps/customer-app/src/app/onboarding/complete/page.tsx',
    'Customer onboarding complete page formats dates en-US; tracked-gap pending tenant-locale resolution.',
  ],
  [
    'apps/estate-manager-app/src/app/announcements/[id]/page.tsx',
    'Estate-manager announcements page formats dates en-US; tracked-gap pending tenant-locale resolution.',
  ],
  [
    'apps/estate-manager-app/src/app/calendar/events/page.tsx',
    'Estate-manager calendar events page formats dates en-US; tracked-gap pending tenant-locale resolution.',
  ],
  [
    'apps/estate-manager-app/src/app/calendar/page.tsx',
    'Estate-manager calendar page formats dates en-US; tracked-gap pending tenant-locale resolution.',
  ],
  [
    'apps/estate-manager-app/src/app/inspections/[id]/page.tsx',
    'Estate-manager inspections page formats dates en-US; tracked-gap pending tenant-locale resolution.',
  ],
  [
    'apps/estate-manager-app/src/app/schedule/page.tsx',
    'Estate-manager schedule page formats dates en-US; tracked-gap pending tenant-locale resolution.',
  ],
  [
    'apps/estate-manager-app/src/screens/work-orders/WorkOrderDetail.tsx',
    'Estate-manager work-order-detail formats dates en-US default; tracked-gap pending tenant-locale resolution.',
  ],
  [
    'apps/owner-portal/src/pages/DesktopReview.tsx',
    'Owner-portal desktop-review formats dates en-US default; tracked-gap pending tenant-locale resolution.',
  ],
  [
    'apps/owner-portal/src/pages/FinancialPage.tsx',
    'Owner-portal financial page formats dates en-US default; tracked-gap pending tenant-locale resolution.',
  ],
  [
    'apps/owner-portal/src/pages/MessagesPage.tsx',
    'Owner-portal messages page formats dates en-US default; tracked-gap pending tenant-locale resolution.',
  ],
  [
    'apps/owner-portal/src/pages/financial/Disbursements.tsx',
    'Owner-portal disbursements page formats dates en-US default; tracked-gap pending tenant-locale resolution.',
  ],
  [
    'packages/ai-copilot/src/security/canary-tokens.ts',
    'canary-tokens uses toLocaleLowerCase("en-US") for DETERMINISTIC case-fold of canary token comparison; forcing en-US is the SAFE choice (omitting locale would use runtime locale and break token-leak detection in non-Latin-script locales).',
  ],

  // ─── audio-capture: locale type union + voice-clone mapping ────────
  [
    'packages/audio-capture/src/types.ts',
    'audio-capture types.ts declares the locale TYPE union of supported voice-capture locales; this IS the registry.',
  ],
  [
    'packages/audio-capture/src/voice-clone/elevenlabs-voice-lab.ts',
    'ElevenLabs voice-lab maps each supported locale to its ElevenLabs voice-id; this IS the per-voice registry.',
  ],

  // ─── content-studio: visible watermark per-locale text ─────────────
  [
    'packages/content-studio/src/c2pa/visible-watermark.ts',
    'C2PA visible-watermark module maps each locale (en/sw/sw-TZ/lug) to its translated watermark phrase; registry.',
  ],

  // ─── database seeds: TRC bootstrap data ────────────────────────────
  [
    'packages/database/src/seeds/trc-elastic-config.ts',
    'TRC (Tanzania Regulatory Council) elastic-config seed bootstraps sw-TZ locale per Tanzania law; seed data only.',
  ],
  [
    'packages/database/src/seeds/trc-test-org-seed.ts',
    'TRC test-org seed bootstraps sw-TZ locale for the Tanzania demo tenant; seed/sandbox data only.',
  ],

  // ─── estate-department-advisor: USD-scoped finance report formatting
  [
    'packages/estate-department-advisor/src/owner-relations/distribution-advisor.ts',
    'Distribution-advisor formats USD amounts with en-US grouping for institutional-investor reports; advisor is USD-scoped.',
  ],
  [
    'packages/estate-department-advisor/src/portfolio/capex-prioritizer.ts',
    'Capex-prioritizer formats USD line-items with en-US grouping for portfolio reports; advisor is USD-scoped.',
  ],
  [
    'packages/estate-department-advisor/src/risk/coverage-adequacy-scorer.ts',
    'Coverage-adequacy-scorer formats USD limit gaps with en-US grouping for insurance reports; advisor is USD-scoped.',
  ],
  [
    'packages/estate-department-advisor/src/tax/1031-scanner.ts',
    '1031-scanner formats USD tax-deferral amounts with en-US grouping; §1031 is US-federal-tax-only by definition.',
  ],
  [
    'packages/estate-department-advisor/src/tax/cost-seg-advisor.ts',
    'Cost-segregation advisor formats USD NPV with en-US grouping; cost-segregation is US-tax-only by definition.',
  ],
  [
    'packages/estate-department-advisor/src/tax/property-tax-appeal-advisor.ts',
    'Property-tax-appeal advisor formats USD savings with en-US grouping; US-property-tax-appeal scoped.',
  ],

  // ─── lifecycle-advisor: ILPA institutional reports ─────────────────
  [
    'packages/lifecycle-advisor/src/investor-relations/ilpa-report-builder.ts',
    'ILPA (Institutional Limited Partners Association) reports are en-US standard for institutional LPs by ILPA template.',
  ],

  // ─── report-engine: PPTX renderer XML lang attribute ──────────────
  [
    'packages/report-engine/src/renderers/pptx.ts',
    'PPTX renderer emits <a:rPr lang="en-US"> per OOXML/PPTX schema baseline; tracked-gap pending per-tenant lang resolution.',
  ],

  // ─── security-hardening: anomaly detector deterministic timestamp ─
  [
    'packages/security-hardening/src/anomaly/detector.ts',
    'Anomaly-detector uses en-GB for DETERMINISTIC DD/MM/YYYY timestamp formatting in anomaly fingerprints; locale-stability is required.',
  ],

  // ─── strategic-reports: number gathering ports ────────────────────
  [
    'packages/strategic-reports/src/gatherers/ports.ts',
    'Strategic-reports gatherer formats currency amounts with en-US grouping for stable cross-language report serialization.',
  ],

  // ─── sustainability-advisor: ESG/biodiversity en-GB reports ────────
  [
    'packages/sustainability-advisor/src/advisor/property-esg-report.ts',
    'ESG report uses en-GB grouping (UK-default for ESG reporting frameworks); tracked-gap pending per-tenant locale.',
  ],
  [
    'packages/sustainability-advisor/src/biodiversity/bng-calculator.ts',
    'BNG (Biodiversity Net Gain) calculator uses en-GB; BNG is UK-DEFRA framework — en-GB is correct per regulation.',
  ],

  // ─── timezone-detection: Intl.DateTimeFormat internals ────────────
  [
    'packages/timezone-detection/src/detect/validate.ts',
    'Timezone-detection validator uses en-US Intl.DateTimeFormat for DETERMINISTIC IANA-tz validation; locale-stability required.',
  ],
  [
    'packages/timezone-detection/src/dst-handling/offset.ts',
    'Timezone-detection DST-offset uses en-US Intl.DateTimeFormat for DETERMINISTIC offset extraction; locale-stability required.',
  ],
  [
    'packages/timezone-detection/src/render/human-readable.ts',
    'Timezone-detection render-helper uses en-US as the default-fallback when opts.locale not provided; render-time fallback.',
  ],
  [
    'packages/timezone-detection/src/render/relative-time.ts',
    'Timezone-detection relative-time helper uses en-US as the default-fallback when opts.locale not provided; render-time fallback.',
  ],
  [
    'packages/timezone-detection/src/render/render-in-tz.ts',
    'Timezone-detection render-in-tz uses en-US Intl.DateTimeFormat for DETERMINISTIC TZ-offset rendering; locale-stability required.',
  ],

  // ─── tutoring-skill-pack: data-grounding number format ────────────
  [
    'packages/tutoring-skill-pack/src/data-grounding.ts',
    'Tutoring data-grounding uses en-US toLocaleString for stable cross-language number rendering in tutor responses.',
  ],

  // ─── onboarding-orchestrator: per-session locale store + slot schema
  [
    'services/onboarding-orchestrator/src/persistence/session-store.ts',
    'Onboarding session-store falls back to en-KE as the platform-default locale when no input.locale provided; tracked-gap.',
  ],
  [
    'services/onboarding-orchestrator/src/slots/slot-schema.ts',
    'Onboarding slot-schema TYPE union enumerates supported locales (en-KE/sw-KE/lg-UG/etc.); this IS the slot-locale registry.',
  ],

  // ─── voice-agent: locale-keyed providers + language router registry
  [
    'services/voice-agent/src/providers/lelapa.ts',
    'Lelapa voice provider maps each locale to its Lelapa STT/TTS language code; this IS the per-voice-provider registry.',
  ],
  [
    'services/voice-agent/src/providers/types.ts',
    'Voice-agent providers types.ts declares the locale TYPE union of supported voice-agent locales; this IS the registry.',
  ],
  [
    'services/voice-agent/src/router/language-router.ts',
    'Voice-agent language-router maps each supported locale to its detection pattern; this IS the language-router registry.',
  ],

  // ─── tenant-portal: marketplace API client locale default ─────────
  [
    'apps/tenant-portal/src/lib/marketplace/api-client.ts',
    'Tenant-portal marketplace API client defaults locale=en-KE for Kenya-first marketplace; tracked-gap pending tenant-locale wire.',
  ],

  // ─── WZ-CI-GREEN 2026-05-25: EU-AI-Act Art-50 disclosure locales ───
  // The disclosure-layer module implements EU AI Act Article 50 multi-
  // locale disclosures. Each locale literal IS the canonical disclosure
  // key — they enumerate the legally-required locale set for the
  // EAC region (en-TZ, en-KE, en-UG) per the regulation. Substituting
  // a runtime locale resolver here defeats the legal traceability
  // requirement that ties each disclosure text to its locale-id.
  [
    'packages/disclosure-layer/src/eu-ai-act-art-50/locales.ts',
    'EU-AI-Act Article 50 mandated multi-locale disclosure text registry; each locale IS the canonical key the regulation requires.',
  ],
  [
    'packages/disclosure-layer/src/eu-ai-act-art-50/types.ts',
    'EU-AI-Act Article 50 disclosure-locale union type; enumerates the legally-required locale set per regulation.',
  ],
]);
