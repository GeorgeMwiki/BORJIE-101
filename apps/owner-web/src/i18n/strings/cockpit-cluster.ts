/**
 * cockpit-cluster — guard-exempt bilingual (sw / en) copy for the
 * owner-cockpit cluster surfaces that previously rendered hardcoded
 * English (or interleaved `EN / SW`) under the localized cockpit chrome
 * — the split-brain / language-mixing class the canon forbids.
 *
 * Covered surfaces:
 *   - components/cockpit/* (the 10 daily-brief tiles + the grid chrome)
 *   - components/site-cockpit/* (tabs, shift report, geology gauge)
 *   - app/(routes)/mwikila/delegation/* (matrix headers, tier labels)
 *   - app/(routes)/mwikila/inbox/* (filters, statuses, actions)
 *
 * Every leaf is `{ en, sw }` (or a pure function returning `{ en, sw }`
 * when the original interpolated a value). Lives under `i18n/` so the
 * locale-purity scanner exempts the Swahili. NEVER concatenate en + sw;
 * the call site resolves exactly one via `pickByLocale` / `[locale]`.
 */

import type { Locale } from '@/lib/locale-shared';

interface SwEn {
  readonly en: string;
  readonly sw: string;
}

export const cockpitClusterStrings = {
  // ── components/cockpit/CockpitGrid.tsx ─────────────────────────────
  grid: {
    errorTitle: {
      en: 'Could not load your daily brief',
      sw: 'Imeshindwa kupakia muhtasari wako wa siku',
    },
    errorBody: {
      en: 'The cockpit brief failed to load. Please try again.',
      sw: 'Muhtasari wa dashibodi umeshindwa kupakia. Tafadhali jaribu tena.',
    },
    updatedAt: (when: string): SwEn => ({
      en: `Updated ${when}`,
      sw: `Imesasishwa ${when}`,
    }),
    refreshing: { en: 'refreshing…', sw: 'inasasisha…' },
  },

  // ── components/cockpit/LicenceHealthCard.tsx ───────────────────────
  licence: {
    title: { en: 'Licence health', sw: 'Afya ya leseni' },
    activeRights: { en: 'active mineral rights', sw: 'haki za madini hai' },
    renewals: (n: number): SwEn => ({
      en: `${n} renewal${n === 1 ? '' : 's'} < 60d`,
      sw: `upyaji ${n} < siku 60`,
    }),
    dormancy: (n: number): SwEn => ({
      en: `${n} dormancy flag`,
      sw: `alama ${n} ya kutotumika`,
    }),
  },

  // ── components/cockpit/ProductionCard.tsx ──────────────────────────
  production: {
    title: { en: 'Production vs target', sw: 'Uzalishaji dhidi ya lengo' },
    // The value is run-of-mine ORE TONNES (the gateway computes tonnes, not gold
    // grammes / assay yield). Label it tonnes (t), never "g" — a ~10^6 unit
    // mislabel that made ore tonnage read as gold grammes.
    tonnes: (t: string): SwEn => ({ en: `${t} t`, sw: `t ${t}` }),
    ofDayTarget: (pct: number): SwEn => ({
      en: `${pct}% of day target`,
      sw: `${pct}% ya lengo la siku`,
    }),
    mtd: (mtd: string, target: string, pct: number): SwEn => ({
      en: `MTD ${mtd} t of ${target} t (${pct}%)`,
      sw: `Tangu mwanzo wa mwezi ${mtd} t kati ya ${target} t (${pct}%)`,
    }),
    // Honest label when NO production target is wired — never a fabricated "0%".
    noTarget: { en: 'Target not set', sw: 'Lengo halijawekwa' },
    mtdNoTarget: (mtd: string): SwEn => ({
      en: `MTD ${mtd} t · target not set`,
      sw: `Tangu mwanzo wa mwezi ${mtd} t · lengo halijawekwa`,
    }),
  },

  // ── components/cockpit/OpenRisksCard.tsx ───────────────────────────
  risks: {
    title: { en: 'Open risks', sw: 'Hatari wazi' },
    none: { en: 'No open risks', sw: 'Hakuna hatari wazi' },
    investigate: (title: string, site: string): SwEn => ({
      en: `Investigate risk: ${title} at ${site}`,
      sw: `Chunguza hatari: ${title} katika ${site}`,
    }),
    sev: {
      low: { en: 'low', sw: 'chini' },
      medium: { en: 'medium', sw: 'wastani' },
      high: { en: 'high', sw: 'juu' },
    },
  },

  // ── components/cockpit/PendingDecisionsCard.tsx ────────────────────
  decisions: {
    title: { en: 'Pending decisions', sw: 'Maamuzi yanayosubiri' },
    from: (who: string): SwEn => ({ en: `from ${who}`, sw: `kutoka ${who}` }),
    waitingDays: (d: number): SwEn => ({ en: `${d}d`, sw: `siku ${d}` }),
  },

  // ── components/cockpit/ActiveSitesCard.tsx ─────────────────────────
  sites: {
    title: { en: 'Active sites', sw: 'Migodi hai' },
    statusOnTrack: { en: 'on-track', sw: 'kwenye mstari' },
    statusWatch: { en: 'watch', sw: 'angalia' },
    statusBehind: { en: 'behind', sw: 'nyuma' },
  },

  // ── estate / sites session-hydration FAILURE affordance ────────────
  // Shown when `OwnerSession.estateLoadError` is true — the sites/estate
  // read from the gateway FAILED (a degrade), as distinct from a genuinely
  // EMPTY estate (estateLoadError false + zero sites). Never render a
  // fake-empty "0 sites" on a failed load; surface this retry affordance
  // instead so the owner knows the count could not be loaded.
  estate: {
    loadFailed: {
      en: 'We could not load your sites right now.',
      sw: 'Hatukuweza kupakia migodi yako kwa sasa.',
    },
    loadFailedHint: {
      en: 'This is a temporary connection issue, not an empty estate.',
      sw: 'Hili ni tatizo la muda la muunganisho, si mali tupu.',
    },
    retry: { en: 'Try again', sw: 'Jaribu tena' },
  },

  // ── components/cockpit/ComplianceCard.tsx ──────────────────────────
  compliance: {
    title: { en: 'Compliance status', sw: 'Hali ya uzingatiaji' },
    obligations: { en: 'obligations tracked', sw: 'majukumu yanayofuatiliwa' },
    green: (n: number): SwEn => ({ en: `${n} green`, sw: `${n} kijani` }),
    amber: (n: number): SwEn => ({ en: `${n} amber`, sw: `${n} njano` }),
    red: (n: number): SwEn => ({ en: `${n} red`, sw: `${n} nyekundu` }),
  },

  // ── components/cockpit/MarketplaceCard.tsx ─────────────────────────
  marketplace: {
    title: { en: 'Marketplace activity', sw: 'Shughuli za soko' },
    meta: (inquiries: number): SwEn => ({
      en: `open offers · ${inquiries} new inquiries (7d)`,
      sw: `ofa wazi · maswali ${inquiries} mapya (siku 7)`,
    }),
    // Honest "feed not wired" meta — shown when the gateway sends null (no
    // marketplace source in this deployment) instead of a fabricated count.
    notWired: {
      en: 'marketplace feed not connected',
      sw: 'mlisho wa soko haujaunganishwa',
    },
    topBuyer: { en: 'Top buyer', sw: 'Mnunuzi mkuu' },
  },

  // ── components/cockpit/FxGoldCard.tsx ──────────────────────────────
  fxGold: {
    title: { en: 'FX & gold window', sw: 'Dirisha la fedha za kigeni na dhahabu' },
    perOz: { en: '/oz', sw: '/aunzi' },
    tzsUsd: (rate: string): SwEn => ({
      en: `TZS/USD ${rate}`,
      sw: `TZS/USD ${rate}`,
    }),
    tzsUsdEmpty: { en: 'TZS/USD —', sw: 'TZS/USD —' },
    sellWindow: (open: boolean): SwEn => ({
      en: `sell window ${open ? 'open' : 'closed'}`,
      sw: `dirisha la kuuza ${open ? 'wazi' : 'limefungwa'}`,
    }),
    cliff: (days: number): SwEn => ({
      en: `27 Mar cliff in ${days}d`,
      sw: `mwisho wa 27 Mac baada ya siku ${days}`,
    }),
  },

  // ── components/cockpit/DailyBriefCard.tsx ──────────────────────────
  dailyBrief: {
    sev: {
      info: { en: 'info', sw: 'taarifa' },
      warn: { en: 'warn', sw: 'tahadhari' },
      critical: { en: 'critical', sw: 'dharura' },
    },
  },

  // ── components/cockpit/CockpitLivePulse.tsx ────────────────────────
  pulse: {
    live: { en: 'Live', sw: 'Mawasiliano hai' },
    reconnecting: { en: 'Reconnecting…', sw: 'Inaunganisha…' },
  },

  // ── components/cockpit/RealtimeLatencyBadge.tsx ────────────────────
  latency: {
    label: { en: 'Live sync', sw: 'Mawasiliano' },
  },

  // ── components/site-cockpit/Tabs.tsx ───────────────────────────────
  siteTabs: {
    shift: { en: 'Shift', sw: 'Zamu' },
    geology: { en: 'Geology', sw: 'Jiolojia' },
    cost: { en: 'Cost', sw: 'Gharama' },
  },

  // ── components/site-cockpit/SiteCockpitSurface.tsx ─────────────────
  siteSurface: {
    notFoundTitle: { en: 'Site not found', sw: 'Mgodi haukupatikana' },
    notFoundBody: {
      en: 'This site does not exist for your account, or the link is stale. Pick a site from the selector above.',
      sw: 'Mgodi huu haupo kwa akaunti yako, au kiungo kimepitwa na wakati. Chagua mgodi kutoka kwenye kichaguzi hapo juu.',
    },
    errorTitle: { en: 'Could not load this site', sw: 'Imeshindwa kupakia mgodi huu' },
    errorBody: (msg: string): SwEn => ({
      en: `The site cockpit failed to load. ${msg}`,
      sw: `Dashibodi ya mgodi imeshindwa kupakia. ${msg}`,
    }),
    tryAgain: { en: 'Please try again.', sw: 'Tafadhali jaribu tena.' },
    noDataTitle: { en: 'No site data yet', sw: 'Hakuna data ya mgodi bado' },
    noDataBody: {
      en: 'This site has no shift, geology, or cost data recorded yet.',
      sw: 'Mgodi huu hauna data ya zamu, jiolojia, au gharama iliyorekodiwa bado.',
    },
  },

  // ── components/site-cockpit/ShiftReportCard.tsx ────────────────────
  shift: {
    latest: { en: 'Latest shift', sw: 'Zamu ya hivi karibuni' },
    shiftSuffix: { en: 'shift', sw: 'zamu' },
    tonnesMined: { en: 'Tonnes mined', sw: 'Tani zilizochimbwa' },
    headGrade: { en: 'Head grade', sw: 'Daraja la madini' },
    grammes: { en: 'Grammes', sw: 'Gramu' },
    variance: { en: 'Variance', sw: 'Tofauti' },
    supervisor: (name: string): SwEn => ({
      en: `Supervisor: ${name}`,
      sw: `Msimamizi: ${name}`,
    }),
    blockers: (n: number): SwEn => ({
      en: `Blockers · ${n}`,
      sw: `Vizuizi · ${n}`,
    }),
    blockerOwner: (who: string): SwEn => ({
      en: `owner: ${who}`,
      sw: `mhusika: ${who}`,
    }),
    photos: (n: number): SwEn => ({
      en: `Photos · ${n}`,
      sw: `Picha · ${n}`,
    }),
    photosEmpty: {
      en: 'No shift photos uploaded yet.',
      sw: 'Hakuna picha za zamu zilizopakiwa bado.',
    },
    sevLow: { en: 'low', sw: 'chini' },
    sevMedium: { en: 'medium', sw: 'wastani' },
    sevHigh: { en: 'high', sw: 'juu' },
  },

  // ── components/site-cockpit/GeologyGauge.tsx ───────────────────────
  geology: {
    title: { en: 'Geology composite score', sw: 'Alama ya pamoja ya jiolojia' },
    scale: {
      en: 'scale 0–100 (drill density · QA/QC · vein continuity)',
      sw: 'kipimo 0–100 (msongamano wa kuchimba · QA/QC · mwendelezo wa mshipa)',
    },
  },

  // ── mwikila/delegation/page.tsx ────────────────────────────────────
  delegationPage: {
    heading: { en: 'Mwikila delegation', sw: 'Uwakilishi wa Mwikila' },
    body: {
      en: 'Set per-category delegation. T0 informs only, T1 drafts and waits for your one-tap approval, T2 acts immediately with a 24-hour reversal window, T3 acts irrevocably (use sparingly).',
      sw: 'Weka uwakilishi kwa kila kazi. T0 inajulisha tu, T1 inaandaa rasimu na kusubiri idhini yako ya mguso mmoja, T2 inatenda mara moja na dirisha la kurudisha la saa 24, T3 inatenda bila kurudishwa (tumia kwa uangalifu).',
    },
  },

  // ── mwikila/delegation/delegation-matrix.tsx ───────────────────────
  delegationMatrix: {
    loading: { en: 'Loading…', sw: 'Inapakia…' },
    categoryHeader: { en: 'Category', sw: 'Kazi' },
    sourceHeader: { en: 'Source', sw: 'Chanzo' },
    tierInformOnly: { en: 'Inform only', sw: 'Kujulisha tu' },
    tierPropose: { en: 'Propose', sw: 'Kupendekeza' },
    tierActReversal: { en: 'Act + reversal', sw: 'Tenda + kurudisha' },
    tierIrrevocable: { en: 'Irrevocable', sw: 'Bila kurudishwa' },
  },

  // ── mwikila/inbox/page.tsx ─────────────────────────────────────────
  inboxPage: {
    heading: { en: 'Acting on your behalf', sw: 'Kutenda kwa niaba yako' },
    body: {
      en: 'Mr. Mwikila handles routine operations under the delegation tiers you set. Every proposal, execution, and safety-rail block lands here for your review. T2 executions are reversible within the window shown.',
      sw: 'Bw. Mwikila anashughulikia shughuli za kawaida kwa viwango vya uwakilishi ulivyoweka. Kila pendekezo, utekelezaji, na uzuiaji wa reli ya usalama unafika hapa kwa ukaguzi wako. Utekelezaji wa T2 unaweza kurudishwa ndani ya dirisha lililoonyeshwa.',
    },
  },

  // ── mwikila/inbox/mwikila-inbox-panel.tsx ──────────────────────────
  inbox: {
    statusLabel: { en: 'Status', sw: 'Hali' },
    categoryLabel: { en: 'Category', sw: 'Kazi' },
    all: { en: 'All', sw: 'Zote' },
    rows: (n: number): SwEn => ({ en: `${n} rows`, sw: `safu ${n}` }),
    loading: { en: 'Loading…', sw: 'Inapakia…' },
    emptyTitle: {
      en: 'No actions to review yet',
      sw: 'Hakuna shughuli za kukagua bado',
    },
    emptyBody: {
      en: 'Mr. Mwikila stays quiet until there is something to act on.',
      sw: 'Bw. Mwikila anabaki kimya hadi kuwe na jambo la kutenda.',
    },
    reversible: (countdown: string): SwEn => ({
      en: `Reversible: ${countdown}`,
      sw: `Inaweza kurudishwa: ${countdown}`,
    }),
    windowClosed: { en: 'Window closed', sw: 'Dirisha limefungwa' },
    blockedByRail: (reason: string): SwEn => ({
      en: `Blocked by inviolable rail: ${reason}`,
      sw: `Imezuiwa na reli isiyovunjika: ${reason}`,
    }),
    approve: { en: 'Approve', sw: 'Idhinisha' },
    deny: { en: 'Deny', sw: 'Kataa' },
    reverse: { en: 'Reverse', sw: 'Rejesha' },
    statusProposed: { en: 'Proposed', sw: 'Pendekezo' },
    statusApproved: { en: 'Approved', sw: 'Imeidhinishwa' },
    statusDenied: { en: 'Denied', sw: 'Imekataliwa' },
    statusExecuted: { en: 'Executed', sw: 'Imefanyika' },
    statusReversed: { en: 'Reversed', sw: 'Imerejeshwa' },
    statusCommitted: { en: 'Committed', sw: 'Imekamilika' },
    statusBlocked: { en: 'Blocked by safety rail', sw: 'Imezuiwa na reli ya usalama' },
    statusExpired: { en: 'Expired', sw: 'Imepitwa' },
  },
} as const;

/** Convenience: select one locale variant from a `{ en, sw }` leaf. */
export function pickCluster(locale: Locale, leaf: SwEn): string {
  return locale === 'sw' ? leaf.sw : leaf.en;
}
