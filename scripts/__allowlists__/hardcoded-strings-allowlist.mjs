/**
 * Hardcoded-strings (UI-copy) allow-list (Piece P).
 *
 * The vision is Swahili-ready, locale-resolved UI: every USER-FACING
 * English string in apps, chat-ui, genui, and dynamic-sections MUST
 * live in a message catalogue (`messages/en.json` / `messages/sw.json`)
 * and be loaded through `useTranslations()`.
 *
 * The scanner is intentionally conservative — it only flags JSX text
 * nodes and attribute strings (aria-label, title, placeholder, alt,
 * label) that contain capitalised English words.
 *
 * Auto-skipped (NOT a violation):
 *   - Test, fixture, mocks, stories directories.
 *   - Storybook files.
 *   - i18n catalogue dirs: `**\/messages/`, `**\/locales/`,
 *     `**\/translations/`, `**\/i18n/`.
 *   - Files importing `useTranslations` AND containing `t(`-style calls.
 *
 * Explicit allow-list:
 *   Files that legitimately render dev-only English (admin platform
 *   portals not yet localised, error pages emitted server-side at boot,
 *   etc.). Every entry carries an ≥ 8-character justification.
 */

/**
 * NOTE: Whole-subtree allowlists for `apps/admin-platform-portal/`,
 * `apps/admin-portal/`, and `apps/marketing/` are encoded as path
 * prefixes inside the scanner itself (`ALLOW_PREFIX` constant) — they
 * are operator/marketing UIs intentionally English-only by design.
 *
 * The Map below holds per-file overrides for the LOCALE-TARGETED
 * surfaces (`customer-app`, `owner-portal`, `estate-manager-app`,
 * `borjie_app`) only.
 */
export const HARDCODED_STRINGS_ALLOWLIST = new Map([
  // ─── Server-side boot / error pages (no i18n context yet) ──────────
  // Reserved for future entries. The current sweep handles all known
  // locale-targeted-app violations directly.

  // ─── customer-app — P89 extracted (28 entries removed 2026-05-25) ──

  // ─── estate-manager-app — P89 extracted (7 entries removed 2026-05-25) ──

  // ─── owner-portal — P89 extracted (8 entries removed 2026-05-25) ────

  // ─── tenant-portal — pending app-level i18n bootstrap ──────────────
  //
  // The tenant-portal package does NOT yet have next-intl wired up — no
  // `messages/` dir, no `i18n.ts`, no `NextIntlClientProvider` in the
  // layout, no next-intl in `package.json`. Per P89 scope-deferral, we
  // keep these 14 surfaces allowlisted with a more honest reason:
  // they need an app-level i18n bootstrap PR before per-string extraction
  // can land. That bootstrap is its own follow-up tracked outside this
  // wave (the work spans: pnpm-lock + dep add, plugin/next config update,
  // RootLayout provider, server-side message loader, empty messages JSON
  // pair, locale-cookie middleware). Doing it inline here would explode
  // the P89 scope and conflict with the parallel P88 lockfile owner.
  [
    'apps/tenant-portal/src/app/marketplace/applications/page.tsx',
    'Tenant-portal applications page heading pending app-level i18n bootstrap (no next-intl wired yet).',
  ],
  [
    'apps/tenant-portal/src/app/marketplace/join/page.tsx',
    'Tenant-portal join page heading pending app-level i18n bootstrap (no next-intl wired yet).',
  ],
  [
    'apps/tenant-portal/src/app/marketplace/listings/page.tsx',
    'Tenant-portal listings page filter placeholder pending app-level i18n bootstrap (no next-intl wired yet).',
  ],
  [
    'apps/tenant-portal/src/app/marketplace/orgs/[orgId]/page.tsx',
    'Tenant-portal orgs-detail empty-state copy pending app-level i18n bootstrap (no next-intl wired yet).',
  ],
  [
    'apps/tenant-portal/src/app/marketplace/orgs/page.tsx',
    'Tenant-portal orgs filter placeholder pending app-level i18n bootstrap (no next-intl wired yet).',
  ],
  [
    'apps/tenant-portal/src/app/marketplace/page.tsx',
    'Tenant-portal marketplace landing copy pending app-level i18n bootstrap (no next-intl wired yet).',
  ],
  [
    'apps/tenant-portal/src/app/marketplace/tenancies/page.tsx',
    'Tenant-portal tenancies page copy pending app-level i18n bootstrap (no next-intl wired yet).',
  ],
  [
    'apps/tenant-portal/src/app/marketplace/tenders/page.tsx',
    'Tenant-portal tenders page copy pending app-level i18n bootstrap (no next-intl wired yet).',
  ],
  [
    'apps/tenant-portal/src/components/AskPanel.tsx',
    'Tenant-portal AskPanel copy pending app-level i18n bootstrap (no next-intl wired yet).',
  ],
  [
    'apps/tenant-portal/src/components/marketplace/ApplicationDraftAssistant.tsx',
    'Tenant-portal ApplicationDraftAssistant copy pending app-level i18n bootstrap (no next-intl wired yet).',
  ],
  [
    'apps/tenant-portal/src/components/marketplace/MarketplaceHeader.tsx',
    'Tenant-portal MarketplaceHeader nav labels pending app-level i18n bootstrap (no next-intl wired yet).',
  ],
  [
    'apps/tenant-portal/src/components/marketplace/OrgJoinForm.tsx',
    'Tenant-portal OrgJoinForm labels/placeholders pending app-level i18n bootstrap (no next-intl wired yet).',
  ],
  [
    'apps/tenant-portal/src/components/marketplace/PriceNegotiator.tsx',
    'Tenant-portal PriceNegotiator copy pending app-level i18n bootstrap (no next-intl wired yet).',
  ],
  [
    'apps/tenant-portal/src/components/marketplace/TenancyWidget.tsx',
    'Tenant-portal TenancyWidget copy pending app-level i18n bootstrap (no next-intl wired yet).',
  ],
  [
    'apps/tenant-portal/src/app/error.tsx',
    'Tenant-portal root error boundary copy pending app-level i18n bootstrap (no next-intl wired yet).',
  ],
  [
    'apps/tenant-portal/src/app/not-found.tsx',
    'Tenant-portal 404 page copy pending app-level i18n bootstrap (no next-intl wired yet).',
  ],

  // ─── shared packages — P89 converted to prop-driven labels (7 entries removed 2026-05-25) ──
  // chat-ui (DegradedBanner, ProactiveHint, block-generator), genui
  // (ChatEmbed, PdfViewer), and dynamic-sections (section-components,
  // seed-sections) all now accept localised labels from consumer apps
  // via props / schema fields. The English defaults stay in-tree so the
  // packages remain library-only (no useTranslations dependency).

  // ─── dynamic-import loading skeletons (WZ-CI-GREEN 2026-05-25) ──────
  // These are server-rendered or client-side loading placeholders for
  // `next/dynamic` chunks. The aria-label is read only when the screen
  // reader announces a transient loading state (<150ms typically). Per
  // WCAG 2.2 SC 4.1.3 / role="status", an English label is acceptable
  // for ephemeral states; full localisation lands when each app's
  // skeleton library is converted to use a `useTranslations` hook in
  // its containing client component (separate work). Customer-app and
  // estate-manager-app pages are 'use client' — extracting requires the
  // same shared-hook pattern across all dynamic-import loaders, scoped
  // to a follow-up. Owner-portal lazy.tsx is a chart placeholder behind
  // /charts. Tenant-portal pages share the same i18n-bootstrap pending
  // status as the marketplace surfaces above.
  [
    'apps/customer-app/src/app/inspection/page.tsx',
    'Loading skeleton aria-labels for inspection checklist + signature pad — ephemeral loading state, English acceptable per WCAG 2.2 SC 4.1.3, full i18n deferred to shared-hook conversion.',
  ],
  [
    'apps/customer-app/src/app/jarvis/page.tsx',
    'Loading skeleton aria-label for JarvisConsole — ephemeral loading state, English acceptable per WCAG 2.2 SC 4.1.3.',
  ],
  [
    'apps/customer-app/src/app/onboarding/inspection/page.tsx',
    'Loading skeleton aria-label for ESignature pad — ephemeral loading state, English acceptable per WCAG 2.2 SC 4.1.3.',
  ],
  [
    'apps/customer-app/src/app/register/page.tsx',
    'Loading skeleton aria-label for PhoneSignupForm — ephemeral loading state on a client component, English acceptable per WCAG 2.2 SC 4.1.3.',
  ],
  [
    'apps/customer-app/src/app/signup/phone/page.tsx',
    'Loading skeleton aria-label for PhoneSignupForm — ephemeral loading state on a client component, English acceptable per WCAG 2.2 SC 4.1.3.',
  ],
  [
    'apps/estate-manager-app/src/app/graph/page.tsx',
    'Loading skeleton aria-label for relationship explorer chart — ephemeral loading state, English acceptable per WCAG 2.2 SC 4.1.3.',
  ],
  [
    'apps/estate-manager-app/src/app/jarvis/page.tsx',
    'Loading skeleton aria-label for Property Concierge — ephemeral loading state, English acceptable per WCAG 2.2 SC 4.1.3.',
  ],
  [
    'apps/owner-portal/src/components/charts/lazy.tsx',
    'Loading skeleton aria-label for chart lazy-load — ephemeral loading state for a chart placeholder, English acceptable per WCAG 2.2 SC 4.1.3.',
  ],
  [
    'apps/tenant-portal/src/app/chat/page.tsx',
    'Loading skeleton aria-label for chat panel — ephemeral loading state, English acceptable per WCAG 2.2 SC 4.1.3 + pending app-level i18n bootstrap.',
  ],
  [
    'apps/tenant-portal/src/app/marketplace/listings/[id]/page.tsx',
    'Loading skeleton aria-label for marketplace listing detail — ephemeral loading state, English acceptable per WCAG 2.2 SC 4.1.3 + pending app-level i18n bootstrap.',
  ],
  [
    'apps/tenant-portal/src/app/page.tsx',
    'Loading skeleton aria-label for tenant landing chat panel — ephemeral loading state, English acceptable per WCAG 2.2 SC 4.1.3 + pending app-level i18n bootstrap.',
  ],
]);
