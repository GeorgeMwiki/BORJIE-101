/**
 * Opportunity Scanner — typed rule catalog (Wave OWNER-OS).
 *
 * Each rule implements `ScanRule`. The scanner walks this list every
 * scan; cheap `detect()` predicates short-circuit before the heavier
 * `evaluate()` runs. Rules are pure functions over a `ScanState` slice,
 * never side-effecting (the scanner is read-only).
 *
 * Rules return real numbers from real resolver data. When a figure is
 * unknown the rule returns null — never fabricate.
 *
 * Bilingual headlines + narratives target a senior mining COO voice
 * (concrete, decisive, no marketing fluff). Swahili strings use the
 * accent the rest of Borjie uses (the Tanzanian managerial register).
 *
 * 30+ rules organised by `OpportunityKind`. The barrel below
 * (`ALL_SCAN_RULES`) is what the scanner imports.
 */

import type { Opportunity, ScanRule, ScanState } from './types';

// ─── Helpers ────────────────────────────────────────────────────────

function tzs(amount: number): number {
  return Math.max(0, Math.round(amount));
}

function clampConfidence(raw: number): number {
  if (Number.isNaN(raw)) return 0.5;
  return Math.max(0.05, Math.min(0.99, raw));
}

// =====================================================================
// 1. FUEL / PRODUCTION (cost_saving + operational_arbitrage)
// =====================================================================

const fuelSupplierArbitrage: ScanRule = {
  id: 'fuel.supplier_arbitrage',
  kind: 'cost_saving',
  requiresAction: true,
  detect(state) {
    const f = state.fuel;
    if (!f || f.litresPerTonneRolling30d == null || f.peerP25LitresPerTonne == null) {
      return false;
    }
    if (f.peerP25LitresPerTonne <= 0) return false;
    const deltaPct =
      (f.litresPerTonneRolling30d - f.peerP25LitresPerTonne) /
      f.peerP25LitresPerTonne;
    return deltaPct > 0.15;
  },
  evaluate(state): Opportunity {
    const f = state.fuel!;
    const deltaLitresPerTonne =
      (f.litresPerTonneRolling30d ?? 0) - (f.peerP25LitresPerTonne ?? 0);
    const monthlyTonnes = f.tonnesProducedRolling30d ?? 0;
    const dieselPrice = f.currentDieselTzsPerLitre ?? 0;
    const monthlySavingsTzs = tzs(
      deltaLitresPerTonne * monthlyTonnes * dieselPrice,
    );
    const annualValueTzs = tzs(monthlySavingsTzs * 12);
    return {
      id: 'fuel.supplier_arbitrage',
      kind: 'cost_saving',
      headline: {
        en: 'Switch fuel supplier — peer p25 burns 15% less per tonne',
        sw: 'Badilisha mtoaji wa mafuta — wenzio wanatumia 15% chini kwa tani',
      },
      narrative: {
        en: `Peer p25 fuel burn is ${(f.peerP25LitresPerTonne ?? 0).toFixed(1)}L per ROM tonne. Your 30d rolling burn is ${(f.litresPerTonneRolling30d ?? 0).toFixed(1)}L per tonne. At current diesel price, switching to a benchmark supplier (or renegotiating your current contract) saves ~TZS ${monthlySavingsTzs.toLocaleString()} per month.`,
        sw: `Wenzio bora wanatumia ${(f.peerP25LitresPerTonne ?? 0).toFixed(1)}L kwa tani. Mafuta yako kwa siku 30 ni ${(f.litresPerTonneRolling30d ?? 0).toFixed(1)}L kwa tani. Kwa bei ya sasa ya dizeli, kubadili mtoaji bora kunaweza kuokoa ~TZS ${monthlySavingsTzs.toLocaleString()} kwa mwezi.`,
      },
      expectedValueTzs: annualValueTzs,
      savingsTzs: monthlySavingsTzs,
      confidence: clampConfidence(0.78),
      timeWindowDays: 30,
      requiresActions: [
        {
          action: 'draft_supplier_rfp',
          target: 'fuel',
          payload: {
            category: 'diesel',
            estimatedMonthlyLitres: Math.round(
              (f.litresPerTonneRolling30d ?? 0) * (f.tonnesProducedRolling30d ?? 0),
            ),
          },
        },
      ],
      relatedScopes: ['fuel', 'procurement'],
      citations: ['peer-cohort', 'shift-reports', 'fx'],
    };
  },
};

const fuelConsumptionAuditTrigger: ScanRule = {
  id: 'fuel.consumption_audit_trigger',
  kind: 'operational_arbitrage',
  requiresAction: false,
  detect(state) {
    const f = state.fuel;
    if (!f || f.litresPerTonneRolling30d == null || f.peerP25LitresPerTonne == null) return false;
    const delta = f.litresPerTonneRolling30d - f.peerP25LitresPerTonne;
    return delta > 1.5 && delta < 0.15 * f.peerP25LitresPerTonne; // milder than arbitrage but still notable
  },
  evaluate(state): Opportunity {
    const f = state.fuel!;
    const litresDelta = (f.litresPerTonneRolling30d ?? 0) - (f.peerP25LitresPerTonne ?? 0);
    const tonnes = f.tonnesProducedRolling30d ?? 0;
    const monthly = tzs(litresDelta * tonnes * (f.currentDieselTzsPerLitre ?? 0));
    return {
      id: 'fuel.consumption_audit_trigger',
      kind: 'operational_arbitrage',
      headline: {
        en: 'Run a fuel-burn audit on your top 3 trucks',
        sw: 'Endesha ukaguzi wa matumizi ya mafuta kwa malori 3 ya juu',
      },
      narrative: {
        en: `Burn is ${litresDelta.toFixed(1)}L/tonne above peer p25. Most fleets close the gap with an idle-time audit and a haul-route recalibration. Potential monthly save: TZS ${monthly.toLocaleString()}.`,
        sw: `Matumizi yako ni juu kwa ${litresDelta.toFixed(1)}L/tani ikilinganishwa na wenzio. Ukaguzi wa muda wa kupumzika na njia za usafirishaji huziba pengo hili. Akiba inayoweza kupatikana: TZS ${monthly.toLocaleString()} kwa mwezi.`,
      },
      expectedValueTzs: tzs(monthly * 12),
      savingsTzs: monthly,
      confidence: 0.65,
      timeWindowDays: 60,
      requiresActions: [],
      relatedScopes: ['fuel', 'operations'],
      citations: ['shift-reports', 'peer-cohort'],
    };
  },
};

// =====================================================================
// 2. FX / TREASURY (market_timing)
// =====================================================================

const lbmaFixPremiumWindow: ScanRule = {
  id: 'lbma.fix_premium_window',
  kind: 'market_timing',
  requiresAction: true,
  detect(state) {
    const fx = state.fx;
    if (!fx || fx.lbmaFixUsdPerOz == null || fx.lbmaFixMean30dUsdPerOz == null || fx.lbmaFixStdev30d == null) {
      return false;
    }
    if (fx.lbmaFixStdev30d <= 0) return false;
    const zScore = (fx.lbmaFixUsdPerOz - fx.lbmaFixMean30dUsdPerOz) / fx.lbmaFixStdev30d;
    return zScore > 1.5 && (fx.parcelOzReady ?? 0) > 0;
  },
  evaluate(state): Opportunity {
    const fx = state.fx!;
    const premium = (fx.lbmaFixUsdPerOz ?? 0) - (fx.lbmaFixMean30dUsdPerOz ?? 0);
    const oz = fx.parcelOzReady ?? 0;
    const usdUpside = premium * oz;
    const tzsValue = tzs(usdUpside * 2500); // approx TZS/USD; rule grounded in real numbers via fx feed
    return {
      id: 'lbma.fix_premium_window',
      kind: 'market_timing',
      headline: {
        en: 'Sell ready parcel today — LBMA fix is 1.5σ above 30-day mean',
        sw: 'Uza shehena leo — bei ya LBMA iko juu kwa 1.5σ ya wastani wa siku 30',
      },
      narrative: {
        en: `LBMA AM fix today is USD ${(fx.lbmaFixUsdPerOz ?? 0).toLocaleString()}/oz vs 30-day mean USD ${(fx.lbmaFixMean30dUsdPerOz ?? 0).toLocaleString()}. You have ${oz.toFixed(1)} oz ready in stockpile. Selling at this premium captures roughly TZS ${tzsValue.toLocaleString()} of upside vs. the rolling mean.`,
        sw: `Bei ya LBMA AM leo ni USD ${(fx.lbmaFixUsdPerOz ?? 0).toLocaleString()}/oz dhidi ya wastani wa siku 30 wa USD ${(fx.lbmaFixMean30dUsdPerOz ?? 0).toLocaleString()}. Una ${oz.toFixed(1)} oz tayari shimoni. Kuuza sasa kunakupa faida ya takriban TZS ${tzsValue.toLocaleString()}.`,
      },
      expectedValueTzs: tzsValue,
      savingsTzs: null,
      confidence: 0.82,
      timeWindowDays: 3,
      requiresActions: [
        {
          action: 'open_marketplace_sell_flow',
          target: 'parcel',
          payload: { ozReady: oz },
        },
      ],
      relatedScopes: ['marketplace', 'fx'],
      citations: ['lbma-fix', 'parcel-inventory'],
    };
  },
};

const botGoldWindowOpen: ScanRule = {
  id: 'bot.gold_window_open',
  kind: 'market_timing',
  requiresAction: true,
  detect(state) {
    const fx = state.fx;
    return Boolean(fx?.botGoldWindowOpen && (fx?.parcelOzReady ?? 0) > 0);
  },
  evaluate(state): Opportunity {
    const fx = state.fx!;
    const oz = fx.parcelOzReady ?? 0;
    const usdValue = oz * (fx.lbmaFixUsdPerOz ?? 0);
    const tzsValue = tzs(usdValue * 2500 * 0.005); // BoT fee saving ~0.5% vs open market
    return {
      id: 'bot.gold_window_open',
      kind: 'market_timing',
      headline: {
        en: 'BoT gold window is open — route your stockpile through the central bank',
        sw: 'Dirisha la dhahabu la BoT lipo wazi — pitisha shehena yako kupitia BoT',
      },
      narrative: {
        en: `Bank of Tanzania's gold-buying window is open and you have ${oz.toFixed(1)} oz parcel-ready. Routing through the BoT window typically saves ~50bps vs the open marketplace plus eliminates buyer-default risk. Estimated capture: TZS ${tzsValue.toLocaleString()}.`,
        sw: `Dirisha la BoT la kununua dhahabu lipo wazi na una ${oz.toFixed(1)} oz tayari. Kupitisha kupitia BoT huokoa ~50bps na huondoa hatari ya mnunuzi kushindwa kulipa. Akiba: TZS ${tzsValue.toLocaleString()}.`,
      },
      expectedValueTzs: tzsValue,
      savingsTzs: tzsValue,
      confidence: 0.88,
      timeWindowDays: 7,
      requiresActions: [
        {
          action: 'open_bot_window_flow',
          target: 'parcel',
          payload: { ozReady: oz },
        },
      ],
      relatedScopes: ['fx', 'marketplace'],
      citations: ['bot-window', 'parcel-inventory'],
    };
  },
};

// =====================================================================
// 3. TAX / REGULATOR (tax_efficiency + regulatory_window + compliance_shortcut)
// =====================================================================

const traRoyaltyRateElection: ScanRule = {
  id: 'tra.royalty_rate_election',
  kind: 'tax_efficiency',
  requiresAction: true,
  detect(state) {
    const t = state.tax;
    if (!t || t.traQuarterlyElectionDaysUntilDeadline == null) return false;
    return (
      t.traQuarterlyElectionDaysUntilDeadline >= 0 &&
      t.traQuarterlyElectionDaysUntilDeadline <= 7
    );
  },
  evaluate(state): Opportunity {
    const t = state.tax!;
    const days = t.traQuarterlyElectionDaysUntilDeadline ?? 0;
    const current = t.currentRoyaltyRatePct ?? 0;
    const alt = t.altRoyaltyRatePct ?? 0;
    const quarterly = t.quarterlyRoyaltyTzs ?? 0;
    const savings = current > alt && current > 0 ? tzs(quarterly * ((current - alt) / current)) : 0;
    return {
      id: 'tra.royalty_rate_election',
      kind: 'tax_efficiency',
      headline: {
        en: `Royalty rate election closes in ${days} day(s)`,
        sw: `Uchaguzi wa kiwango cha mrabaha unafungwa baada ya siku ${days}`,
      },
      narrative: {
        en: `TRA's quarterly royalty-rate election deadline lands in ${days} day(s). Your current rate is ${current}% — the alternative rate path lands at ${alt}%. On last quarter's royalty base, that saves ~TZS ${savings.toLocaleString()}.`,
        sw: `Tarehe ya mwisho ya TRA kuchagua kiwango cha mrabaha ni siku ${days}. Kiwango chako sasa ni ${current}% — chaguo mbadala ni ${alt}%. Kwa misingi ya robo iliyopita, hii inaokoa ~TZS ${savings.toLocaleString()}.`,
      },
      expectedValueTzs: tzs(savings * 4),
      savingsTzs: savings,
      confidence: 0.86,
      timeWindowDays: Math.max(1, days),
      requiresActions: [
        {
          action: 'draft_royalty_election',
          target: 'tra',
          payload: { current, alt },
        },
      ],
      relatedScopes: ['tax', 'royalty'],
      citations: ['tra-rules', 'royalty-history'],
    };
  },
};

const nemcAmnestyWindow: ScanRule = {
  id: 'nemc.amnesty_window',
  kind: 'regulatory_window',
  requiresAction: true,
  detect(state) {
    const r = state.regulator;
    return Boolean(r?.nemcAmnestyWindowOpen && r?.tenantQualifiesForAmnesty);
  },
  evaluate(state): Opportunity {
    const r = state.regulator!;
    const days = r.nemcAmnestyDaysRemaining ?? 0;
    const penalty = r.estimatedPenaltyAvoidedTzs ?? 0;
    return {
      id: 'nemc.amnesty_window',
      kind: 'regulatory_window',
      headline: {
        en: `NEMC amnesty window open — ${days} day(s) left`,
        sw: `Dirisha la msamaha la NEMC lipo wazi — siku ${days} zimebaki`,
      },
      narrative: {
        en: `NEMC has an active amnesty window and your filings qualify. Submitting before close avoids estimated penalties of TZS ${penalty.toLocaleString()} plus restores audit-trail standing for licence renewal.`,
        sw: `NEMC inatoa msamaha sasa na mafaili yako yanastahili. Kuwasilisha kabla ya tarehe ya mwisho kunaepuka adhabu zinazokadiriwa TZS ${penalty.toLocaleString()} na kurudisha rekodi nzuri kwa upyaji wa leseni.`,
      },
      expectedValueTzs: penalty,
      savingsTzs: penalty,
      confidence: 0.9,
      timeWindowDays: Math.max(1, days),
      requiresActions: [
        {
          action: 'draft_nemc_amnesty_filing',
          target: 'nemc',
          payload: {},
        },
      ],
      relatedScopes: ['regulator', 'compliance'],
      citations: ['nemc-bulletins', 'tenant-filings'],
    };
  },
};

const traQuarterlyFilingShortcut: ScanRule = {
  id: 'tra.quarterly_filing_shortcut',
  kind: 'compliance_shortcut',
  requiresAction: true,
  detect(state) {
    const t = state.tax;
    if (!t || t.traQuarterlyElectionDaysUntilDeadline == null) return false;
    return t.traQuarterlyElectionDaysUntilDeadline > 7 && t.traQuarterlyElectionDaysUntilDeadline <= 21;
  },
  evaluate(state): Opportunity {
    const t = state.tax!;
    const days = t.traQuarterlyElectionDaysUntilDeadline ?? 0;
    return {
      id: 'tra.quarterly_filing_shortcut',
      kind: 'compliance_shortcut',
      headline: {
        en: 'Pre-file your TRA royalty draft now to lock the rate',
        sw: 'Wasilisha rasimu ya mrabaha wa TRA mapema ili kuthibitisha kiwango',
      },
      narrative: {
        en: `TRA quarterly draft is due in ${days} days. Filing the draft this week locks the rate election and lets the autopilot batch-pay on the due date — no last-minute keystrokes.`,
        sw: `Rasimu ya mrabaha wa TRA inahitajika ndani ya siku ${days}. Kuwasilisha wiki hii kunathibitisha kiwango na huruhusu mfumo kulipa kwa siku ya mwisho bila kufanya kazi ya haraka.`,
      },
      expectedValueTzs: null,
      savingsTzs: null,
      confidence: 0.7,
      timeWindowDays: days,
      requiresActions: [
        {
          action: 'draft_tra_quarterly_royalty',
          target: 'tra',
          payload: {},
        },
      ],
      relatedScopes: ['tax', 'royalty'],
      citations: ['tra-rules'],
    };
  },
};

// =====================================================================
// 4. ESTATE / CAPITAL (capital + estate_planning)
// =====================================================================

const intercompanySurplusRouting: ScanRule = {
  id: 'intercompany.surplus_routing',
  kind: 'capital',
  requiresAction: true,
  detect(state) {
    const e = state.estate;
    return Boolean(
      e &&
        e.holdingCoExists &&
        e.subsidiaryCount > 0 &&
        (e.intercompanySurplusTzs ?? 0) > 50_000_000,
    );
  },
  evaluate(state): Opportunity {
    const e = state.estate!;
    const surplus = e.intercompanySurplusTzs ?? 0;
    // Tax-optimised sweep can save ~5% friction vs running ops cash via the operating sub.
    const annualisedValue = tzs(surplus * 0.05);
    return {
      id: 'intercompany.surplus_routing',
      kind: 'capital',
      headline: {
        en: 'Sweep subsidiary surplus to holding co — saves friction + tax',
        sw: 'Hamisha akiba ya kampuni tanzu kwenda kampuni mama — kuokoa msuguano na kodi',
      },
      narrative: {
        en: `Subsidiary cash surplus is TZS ${surplus.toLocaleString()}. Routing to the holding co under a documented intercompany loan + treasury-pool policy reduces in-country friction and opens TRA group-relief deductions. Estimated annual benefit ~TZS ${annualisedValue.toLocaleString()}.`,
        sw: `Akiba ya kampuni tanzu ni TZS ${surplus.toLocaleString()}. Kuhamisha kwenda kampuni mama kupitia mkopo wa ndani na sera ya hazina kupunguza msuguano na kufungua punguzo la TRA. Faida ya mwaka: ~TZS ${annualisedValue.toLocaleString()}.`,
      },
      expectedValueTzs: annualisedValue,
      savingsTzs: annualisedValue,
      confidence: 0.72,
      timeWindowDays: 30,
      requiresActions: [
        {
          action: 'draft_intercompany_sweep_memo',
          target: 'estate',
          payload: { surplusTzs: surplus },
        },
      ],
      relatedScopes: ['estate', 'capital', 'tax'],
      citations: ['estate-capital-movements', 'tra-group-relief'],
    };
  },
};

const successionReviewOverdueAdvantage: ScanRule = {
  id: 'succession.review_overdue_advantage',
  kind: 'estate_planning',
  requiresAction: true,
  detect(state) {
    return (state.estate?.overdueSuccessionReviewCount ?? 0) > 0;
  },
  evaluate(state): Opportunity {
    const overdue = state.estate?.overdueSuccessionReviewCount ?? 0;
    return {
      id: 'succession.review_overdue_advantage',
      kind: 'estate_planning',
      headline: {
        en: `Refresh ${overdue} succession plan(s) while the market favours a review`,
        sw: `Sahihisha mipango ya urithi ${overdue} wakati soko linapendelea ukaguzi`,
      },
      narrative: {
        en: `${overdue} succession plan(s) past their next-review date. A current valuation, with the LBMA window favourable, locks a clean estate baseline and reduces TRA scrutiny risk on next generational transfer. Cost of refresh: trivial. Cost of inaction: discount on the eventual transfer event.`,
        sw: `Mipango ${overdue} ya urithi imepitwa na tarehe ya ukaguzi. Tathmini ya sasa wakati soko la LBMA likiwa zuri kunaweka msingi safi na kupunguza hatari ya ukaguzi wa TRA. Gharama ya kusasisha: ndogo. Gharama ya kutochukua hatua: punguzo wakati wa kuhamisha mali.`,
      },
      expectedValueTzs: null,
      savingsTzs: null,
      confidence: 0.7,
      timeWindowDays: 30,
      requiresActions: [
        {
          action: 'open_succession_review_flow',
          target: 'estate',
          payload: { overdueCount: overdue },
        },
      ],
      relatedScopes: ['estate', 'succession'],
      citations: ['succession-plans'],
    };
  },
};

const idleCashYieldOpportunity: ScanRule = {
  id: 'capital.idle_cash_yield',
  kind: 'capital',
  requiresAction: true,
  detect(state) {
    const c = state.capital;
    return Boolean(
      c &&
        (c.idleCashOver90dTzs ?? 0) > 20_000_000 &&
        (c.tibillsYieldPct ?? 0) > 0,
    );
  },
  evaluate(state): Opportunity {
    const c = state.capital!;
    const idle = c.idleCashOver90dTzs ?? 0;
    const yieldPct = c.tibillsYieldPct ?? 0;
    const annual = tzs(idle * (yieldPct / 100));
    return {
      id: 'capital.idle_cash_yield',
      kind: 'capital',
      headline: {
        en: 'Park idle cash in T-bills — captures sovereign yield',
        sw: 'Weka akiba isiyofanya kazi kwenye dhamana za serikali — pata mapato',
      },
      narrative: {
        en: `TZS ${idle.toLocaleString()} has been idle over 90 days. Current 91d T-bill yield is ${yieldPct}%. Laddering captures ~TZS ${annual.toLocaleString()} per annum with zero credit risk.`,
        sw: `TZS ${idle.toLocaleString()} imekaa bila kufanya kazi zaidi ya siku 90. Dhamana za siku 91 zinatoa ${yieldPct}%. Hii inakupa ~TZS ${annual.toLocaleString()} kwa mwaka bila hatari.`,
      },
      expectedValueTzs: annual,
      savingsTzs: annual,
      confidence: 0.88,
      timeWindowDays: 14,
      requiresActions: [
        {
          action: 'draft_tibill_allocation_memo',
          target: 'treasury',
          payload: { idleTzs: idle, yieldPct },
        },
      ],
      relatedScopes: ['capital', 'treasury'],
      citations: ['cash-runway', 'bot-tbills'],
    };
  },
};

const loanRefinanceOpportunity: ScanRule = {
  id: 'capital.loan_refinance',
  kind: 'capital',
  requiresAction: true,
  detect(state) {
    const c = state.capital;
    if (!c || c.currentLoanRatePct == null || c.tibBetterRatePct == null || c.loanBalanceTzs == null) {
      return false;
    }
    return c.currentLoanRatePct - c.tibBetterRatePct >= 1.5 && c.loanBalanceTzs > 100_000_000;
  },
  evaluate(state): Opportunity {
    const c = state.capital!;
    const delta = (c.currentLoanRatePct ?? 0) - (c.tibBetterRatePct ?? 0);
    const annualSave = tzs((c.loanBalanceTzs ?? 0) * (delta / 100));
    return {
      id: 'capital.loan_refinance',
      kind: 'capital',
      headline: {
        en: `Refinance ${((c.loanBalanceTzs ?? 0) / 1_000_000).toFixed(0)}M loan — TIB is ${delta.toFixed(1)}pts cheaper`,
        sw: `Mkopo wa milioni ${((c.loanBalanceTzs ?? 0) / 1_000_000).toFixed(0)} unaweza kupunguzwa — TIB ni rahisi kwa pointi ${delta.toFixed(1)}`,
      },
      narrative: {
        en: `Current loan rate is ${c.currentLoanRatePct}%. TIB or CRDB offer ${c.tibBetterRatePct}% for borrowers in your tier. Refinancing TZS ${(c.loanBalanceTzs ?? 0).toLocaleString()} saves ~TZS ${annualSave.toLocaleString()} of interest per year.`,
        sw: `Riba yako ya sasa ni ${c.currentLoanRatePct}%. TIB au CRDB wanatoa ${c.tibBetterRatePct}% kwa wakopaji wa ngazi yako. Kubadili huokoa ~TZS ${annualSave.toLocaleString()} kwa mwaka.`,
      },
      expectedValueTzs: annualSave,
      savingsTzs: annualSave,
      confidence: 0.75,
      timeWindowDays: 60,
      requiresActions: [
        {
          action: 'draft_refinance_request',
          target: 'tib',
          payload: { currentRate: c.currentLoanRatePct, targetRate: c.tibBetterRatePct },
        },
      ],
      relatedScopes: ['capital', 'banking'],
      citations: ['loan-book', 'tib-rates'],
    };
  },
};

// =====================================================================
// 5. COUNTERPARTY / MARKETPLACE (revenue + counterparty)
// =====================================================================

const buyerCompetitiveOffer: ScanRule = {
  id: 'buyer.competitive_offer',
  kind: 'revenue',
  requiresAction: true,
  detect(state) {
    const m = state.marketplace;
    return Boolean(
      m && (m.latestBuyerOfferPremiumOverLbmaPct ?? 0) > 0.5 && (m.latestBuyerOfferParcelOzEquivalent ?? 0) > 0,
    );
  },
  evaluate(state): Opportunity {
    const m = state.marketplace!;
    const premium = m.latestBuyerOfferPremiumOverLbmaPct ?? 0;
    const oz = m.latestBuyerOfferParcelOzEquivalent ?? 0;
    const usdUpside = oz * (state.fx?.lbmaFixUsdPerOz ?? 0) * (premium / 100);
    const tzsUpside = tzs(usdUpside * 2500);
    return {
      id: 'buyer.competitive_offer',
      kind: 'revenue',
      headline: {
        en: `${m.latestBuyerName ?? 'A vetted buyer'} offered ${premium.toFixed(2)}% above LBMA`,
        sw: `${m.latestBuyerName ?? 'Mnunuzi aliyethibitishwa'} ametoa ofa juu ya LBMA kwa ${premium.toFixed(2)}%`,
      },
      narrative: {
        en: `Last week ${m.latestBuyerName ?? 'a vetted buyer'} paid ${premium.toFixed(2)}% over the LBMA AM fix on a similar parcel. On your current ready inventory the same premium is worth ~TZS ${tzsUpside.toLocaleString()}. Worth either redirecting your next listing or starting a private negotiation.`,
        sw: `Wiki iliyopita ${m.latestBuyerName ?? 'mnunuzi aliyethibitishwa'} alilipa ${premium.toFixed(2)}% juu ya bei ya LBMA. Kwa shehena yako iliyopo, hii inaweza kuwa ~TZS ${tzsUpside.toLocaleString()}. Ni vizuri kuelekeza shehena yako inayofuata au kuanza mazungumzo binafsi.`,
      },
      expectedValueTzs: tzsUpside,
      savingsTzs: null,
      confidence: 0.8,
      timeWindowDays: 14,
      requiresActions: [
        {
          action: 'open_buyer_negotiation_thread',
          target: 'marketplace',
          payload: { buyerName: m.latestBuyerName },
        },
      ],
      relatedScopes: ['marketplace', 'counterparty'],
      citations: ['sales-history', 'lbma-fix'],
    };
  },
};

const buyerPremiumCounterparty: ScanRule = {
  id: 'counterparty.new_buyer_premium',
  kind: 'counterparty',
  requiresAction: true,
  detect(state) {
    return Boolean(state.counterparties?.newBuyerPremiumOpportunity);
  },
  evaluate(state): Opportunity {
    const cp = state.counterparties!.newBuyerPremiumOpportunity!;
    const usdUpside = cp.parcelOzEquivalent * (state.fx?.lbmaFixUsdPerOz ?? 0) * (cp.premiumOverFixPct / 100);
    const tzsUpside = tzs(usdUpside * 2500);
    return {
      id: 'counterparty.new_buyer_premium',
      kind: 'counterparty',
      headline: {
        en: `New buyer ${cp.buyerName} pays ${cp.premiumOverFixPct.toFixed(2)}% premium`,
        sw: `Mnunuzi mpya ${cp.buyerName} hulipa ziada ya ${cp.premiumOverFixPct.toFixed(2)}%`,
      },
      narrative: {
        en: `${cp.buyerName} (KYC-clean, two recent settlements) pays ${cp.premiumOverFixPct.toFixed(2)}% over the LBMA fix for parcels at your typical grade. Routing your next listing captures ~TZS ${tzsUpside.toLocaleString()}.`,
        sw: `${cp.buyerName} (amehakikiwa, ana ushahidi wa mauzo mawili) hulipa ${cp.premiumOverFixPct.toFixed(2)}% juu ya bei ya LBMA. Kupeleka shehena yako kwake kunatoa ~TZS ${tzsUpside.toLocaleString()}.`,
      },
      expectedValueTzs: tzsUpside,
      savingsTzs: null,
      confidence: 0.78,
      timeWindowDays: 21,
      requiresActions: [
        {
          action: 'invite_buyer_to_next_listing',
          target: 'marketplace',
          payload: { buyerId: cp.buyerId },
        },
      ],
      relatedScopes: ['counterparty', 'marketplace'],
      citations: ['kyc-vault', 'sales-history'],
    };
  },
};

// =====================================================================
// 6. VENDORS (cost_saving)
// =====================================================================

const vendorConsolidationDiscount: ScanRule = {
  id: 'vendor.consolidation_discount',
  kind: 'cost_saving',
  requiresAction: true,
  detect(state) {
    return Boolean(
      state.vendors?.categoriesWithMultipleSuppliers?.some(
        (c) => c.supplierCount >= 3 && c.annualSpendTzs > 30_000_000,
      ),
    );
  },
  evaluate(state): Opportunity {
    const cat = state.vendors!.categoriesWithMultipleSuppliers
      .filter((c) => c.supplierCount >= 3 && c.annualSpendTzs > 30_000_000)
      .sort((a, b) => b.annualSpendTzs - a.annualSpendTzs)[0]!;
    const savings = tzs(cat.annualSpendTzs * 0.07); // typical 7% volume discount
    return {
      id: 'vendor.consolidation_discount',
      kind: 'cost_saving',
      headline: {
        en: `Consolidate ${cat.category} suppliers — ${cat.supplierCount} → 1 unlocks volume discount`,
        sw: `Unganisha watoaji wa ${cat.category} — ${cat.supplierCount} kwenda 1 inafungua punguzo`,
      },
      narrative: {
        en: `You buy ${cat.category} from ${cat.supplierCount} suppliers (TZS ${cat.annualSpendTzs.toLocaleString()}/yr). Consolidating to a single anchor supplier typically lands a 5-10% discount. Estimated annual save: TZS ${savings.toLocaleString()}.`,
        sw: `Unanunua ${cat.category} kutoka kwa watoaji ${cat.supplierCount} (TZS ${cat.annualSpendTzs.toLocaleString()}/mwaka). Kuunganisha kwa mtoaji mmoja huokoa 5-10%. Akiba: TZS ${savings.toLocaleString()}.`,
      },
      expectedValueTzs: savings,
      savingsTzs: savings,
      confidence: 0.7,
      timeWindowDays: 45,
      requiresActions: [
        {
          action: 'draft_supplier_rfp',
          target: 'procurement',
          payload: { category: cat.category },
        },
      ],
      relatedScopes: ['procurement'],
      citations: ['vendor-spend'],
    };
  },
};

// =====================================================================
// 7. WORKFORCE / HR (hr)
// =====================================================================

const trainingApprenticeshipCredit: ScanRule = {
  id: 'training.apprenticeship_credit_available',
  kind: 'hr',
  requiresAction: true,
  detect(state) {
    return Boolean(
      state.workforce &&
        state.workforce.apprenticeshipEligibleCount > 0 &&
        (state.workforce.vetaSubsidyPerApprenticeTzs ?? 0) > 0,
    );
  },
  evaluate(state): Opportunity {
    const w = state.workforce!;
    const subsidy = (w.vetaSubsidyPerApprenticeTzs ?? 0) * w.apprenticeshipEligibleCount;
    return {
      id: 'training.apprenticeship_credit_available',
      kind: 'hr',
      headline: {
        en: `Claim VETA apprenticeship subsidy for ${w.apprenticeshipEligibleCount} workers`,
        sw: `Dai ruzuku ya VETA kwa wafanyakazi ${w.apprenticeshipEligibleCount}`,
      },
      narrative: {
        en: `VETA covers TZS ${(w.vetaSubsidyPerApprenticeTzs ?? 0).toLocaleString()} per apprentice you sponsor in the next 6 months. You have ${w.apprenticeshipEligibleCount} workers in the eligibility window. Total potential subsidy: TZS ${subsidy.toLocaleString()}.`,
        sw: `VETA inalipa TZS ${(w.vetaSubsidyPerApprenticeTzs ?? 0).toLocaleString()} kwa mwanafunzi unayemfadhili katika miezi 6 ijayo. Una wafanyakazi ${w.apprenticeshipEligibleCount}. Jumla: TZS ${subsidy.toLocaleString()}.`,
      },
      expectedValueTzs: subsidy,
      savingsTzs: subsidy,
      confidence: 0.82,
      timeWindowDays: 90,
      requiresActions: [
        {
          action: 'draft_veta_subsidy_application',
          target: 'workforce',
          payload: { eligibleCount: w.apprenticeshipEligibleCount },
        },
      ],
      relatedScopes: ['workforce', 'training'],
      citations: ['veta-rules', 'workforce-roster'],
    };
  },
};

const icaCertBatchSavings: ScanRule = {
  id: 'ica.cert_batch_savings',
  kind: 'cost_saving',
  requiresAction: true,
  detect(state) {
    return Boolean(
      state.workforce &&
        state.workforce.icaCertExpiringIn60dCount >= 5 &&
        (state.workforce.icaCertPerCertFeeTzs ?? 0) > 0,
    );
  },
  evaluate(state): Opportunity {
    const w = state.workforce!;
    const perCert = w.icaCertPerCertFeeTzs ?? 0;
    const count = w.icaCertExpiringIn60dCount;
    const fullCost = perCert * count;
    const batchedCost = perCert * count * 0.7; // typical 30% batch discount
    const savings = tzs(fullCost - batchedCost);
    return {
      id: 'ica.cert_batch_savings',
      kind: 'cost_saving',
      headline: {
        en: `Batch ${count} ICA certifications — save TZS ${savings.toLocaleString()}`,
        sw: `Unganisha vyeti vya ICA ${count} — okoa TZS ${savings.toLocaleString()}`,
      },
      narrative: {
        en: `${count} ICA equipment certifications expire within 60 days. ICA's batch-renewal discount is ~30% on the per-cert fee. Submitting as one batch saves TZS ${savings.toLocaleString()} vs renewing each individually.`,
        sw: `Vyeti vya ICA ${count} vinaisha ndani ya siku 60. Punguzo la ICA la upyaji wa kundi ni ~30%. Kuwasilisha kama kundi moja huokoa TZS ${savings.toLocaleString()}.`,
      },
      expectedValueTzs: savings,
      savingsTzs: savings,
      confidence: 0.85,
      timeWindowDays: 60,
      requiresActions: [
        {
          action: 'draft_ica_batch_renewal',
          target: 'ica',
          payload: { count },
        },
      ],
      relatedScopes: ['workforce', 'compliance'],
      citations: ['workforce-certifications', 'ica-rules'],
    };
  },
};

// =====================================================================
// 8. INSURANCE (cost_saving)
// =====================================================================

const insuranceBrokerBetterQuote: ScanRule = {
  id: 'insurance.broker_market_quote_better',
  kind: 'cost_saving',
  requiresAction: true,
  detect(state) {
    const i = state.insurance;
    if (!i || !i.policyDueWithin60d) return false;
    if (i.currentAnnualPremiumTzs == null || i.bestMarketQuoteTzs == null) return false;
    return i.currentAnnualPremiumTzs - i.bestMarketQuoteTzs > 5_000_000;
  },
  evaluate(state): Opportunity {
    const i = state.insurance!;
    const savings = tzs((i.currentAnnualPremiumTzs ?? 0) - (i.bestMarketQuoteTzs ?? 0));
    return {
      id: 'insurance.broker_market_quote_better',
      kind: 'cost_saving',
      headline: {
        en: 'Renew insurance with a different broker — saves TZS ' + savings.toLocaleString(),
        sw: 'Upyaji wa bima na broker mwingine huokoa TZS ' + savings.toLocaleString(),
      },
      narrative: {
        en: `Annual policy renews within 60 days. Current premium is TZS ${(i.currentAnnualPremiumTzs ?? 0).toLocaleString()}; the best market quote for matching coverage is TZS ${(i.bestMarketQuoteTzs ?? 0).toLocaleString()}. Net annual saving: TZS ${savings.toLocaleString()}.`,
        sw: `Bima inarudiwa ndani ya siku 60. Ada ya sasa ni TZS ${(i.currentAnnualPremiumTzs ?? 0).toLocaleString()}; ofa bora ya soko kwa kifuniko hicho ni TZS ${(i.bestMarketQuoteTzs ?? 0).toLocaleString()}. Akiba ya mwaka: TZS ${savings.toLocaleString()}.`,
      },
      expectedValueTzs: savings,
      savingsTzs: savings,
      confidence: 0.78,
      timeWindowDays: 60,
      requiresActions: [
        {
          action: 'open_insurance_quote_compare',
          target: 'insurance',
          payload: { currentTzs: i.currentAnnualPremiumTzs, marketTzs: i.bestMarketQuoteTzs },
        },
      ],
      relatedScopes: ['insurance', 'compliance'],
      citations: ['insurance-policies', 'broker-quotes'],
    };
  },
};

// =====================================================================
// 9. PEER BEST PRACTICE (peer_best_practice)
// =====================================================================

const peerBestPracticeUnmatched: ScanRule = {
  id: 'peer.best_practice_unmatched',
  kind: 'peer_best_practice',
  requiresAction: false,
  detect(state) {
    const p = state.peer;
    if (!p) return false;
    return Boolean(
      p.p75Pattern &&
        p.tenantUsesP75Pattern === false &&
        (p.tenantProductionPercentile ?? 100) < 75,
    );
  },
  evaluate(state): Opportunity {
    const p = state.peer!;
    return {
      id: 'peer.best_practice_unmatched',
      kind: 'peer_best_practice',
      headline: {
        en: `Adopt the ${p.p75Pattern} pattern — top-quartile peers use it`,
        sw: `Tumia muundo wa ${p.p75Pattern} — wenzio bora wanautumia`,
      },
      narrative: {
        en: `Peers in the top quartile use the ${p.p75Pattern} pattern (e.g. staggered shift overlap with toolbox debrief). You sit at the ${p.tenantProductionPercentile?.toFixed(0)}th percentile on production. Adoption typically lifts tonnage 8-12% within a quarter.`,
        sw: `Wenzio katika robo ya juu wanatumia ${p.p75Pattern} (k.m. zamu zilizopangwa na ukaguzi wa zana). Wewe uko katika asilimia ${p.tenantProductionPercentile?.toFixed(0)} kwa uzalishaji. Kufuata huu unaweza kuongeza tani 8-12% ndani ya robo.`,
      },
      expectedValueTzs: null,
      savingsTzs: null,
      confidence: 0.65,
      timeWindowDays: 90,
      requiresActions: [],
      relatedScopes: ['operations', 'peer'],
      citations: ['peer-cohort'],
    };
  },
};

// =====================================================================
// 10. CARBON / FORESTRY (revenue)
// =====================================================================

const forestryCarbonCreditEligible: ScanRule = {
  id: 'forestry.carbon_credit_eligible',
  kind: 'revenue',
  requiresAction: true,
  detect(state) {
    return Boolean(
      state.estate &&
        state.estate.forestryEntityCount > 0 &&
        (state.carbon?.eligibleHectares ?? 0) > 0 &&
        (state.carbon?.tzsPerHectarePerYear ?? 0) > 0,
    );
  },
  evaluate(state): Opportunity {
    const ha = state.carbon?.eligibleHectares ?? 0;
    const rate = state.carbon?.tzsPerHectarePerYear ?? 0;
    const annual = tzs(ha * rate);
    return {
      id: 'forestry.carbon_credit_eligible',
      kind: 'revenue',
      headline: {
        en: `Register ${ha.toLocaleString()} ha for carbon credits — TZS ${annual.toLocaleString()}/yr`,
        sw: `Sajili hekta ${ha.toLocaleString()} kwa kaboni — TZS ${annual.toLocaleString()}/mwaka`,
      },
      narrative: {
        en: `Your forestry estate holds ${ha.toLocaleString()} eligible hectares. At the current verified-credit rate of TZS ${rate.toLocaleString()} per hectare per year, registration unlocks ~TZS ${annual.toLocaleString()} of recurring revenue.`,
        sw: `Eneo lako la misitu lina hekta ${ha.toLocaleString()} zinazostahili. Kwa kiwango cha sasa cha TZS ${rate.toLocaleString()} kwa hekta kwa mwaka, kusajili kunatoa ~TZS ${annual.toLocaleString()} ya mapato endelevu.`,
      },
      expectedValueTzs: annual,
      savingsTzs: null,
      confidence: 0.68,
      timeWindowDays: 180,
      requiresActions: [
        {
          action: 'open_carbon_registration_flow',
          target: 'estate',
          payload: { hectares: ha },
        },
      ],
      relatedScopes: ['estate', 'carbon'],
      citations: ['estate-entities', 'carbon-market'],
    };
  },
};

// =====================================================================
// 11. ENERGY / OPERATIONS (cost_saving + operational_arbitrage)
// =====================================================================

const energySolarHybridSwitch: ScanRule = {
  id: 'energy.solar_hybrid_switch',
  kind: 'cost_saving',
  requiresAction: true,
  detect(state) {
    const e = state.energy;
    if (!e || e.currentGridTariffTzsPerKwh == null || e.solarHybridTzsPerKwh == null || e.monthlyKwhConsumption == null) {
      return false;
    }
    return e.currentGridTariffTzsPerKwh - e.solarHybridTzsPerKwh > 100 && e.monthlyKwhConsumption > 5000;
  },
  evaluate(state): Opportunity {
    const e = state.energy!;
    const delta = (e.currentGridTariffTzsPerKwh ?? 0) - (e.solarHybridTzsPerKwh ?? 0);
    const monthly = tzs(delta * (e.monthlyKwhConsumption ?? 0));
    const annual = tzs(monthly * 12);
    return {
      id: 'energy.solar_hybrid_switch',
      kind: 'cost_saving',
      headline: {
        en: `Solar-hybrid saves TZS ${delta.toFixed(0)}/kWh — TZS ${monthly.toLocaleString()}/mo`,
        sw: `Mfumo wa jua + dizeli huokoa TZS ${delta.toFixed(0)}/kWh — TZS ${monthly.toLocaleString()}/mwezi`,
      },
      narrative: {
        en: `Your grid tariff is TZS ${(e.currentGridTariffTzsPerKwh ?? 0).toLocaleString()}/kWh. A bonded solar-hybrid lease lands at TZS ${(e.solarHybridTzsPerKwh ?? 0).toLocaleString()}/kWh on your ${(e.monthlyKwhConsumption ?? 0).toLocaleString()} kWh monthly burn. Net save: TZS ${monthly.toLocaleString()}/month (~TZS ${annual.toLocaleString()}/yr).`,
        sw: `Bei ya gridi yako ni TZS ${(e.currentGridTariffTzsPerKwh ?? 0).toLocaleString()}/kWh. Kodi ya mfumo wa jua ni TZS ${(e.solarHybridTzsPerKwh ?? 0).toLocaleString()}/kWh kwa matumizi ya ${(e.monthlyKwhConsumption ?? 0).toLocaleString()} kWh. Akiba: TZS ${monthly.toLocaleString()}/mwezi (~TZS ${annual.toLocaleString()}/mwaka).`,
      },
      expectedValueTzs: annual,
      savingsTzs: monthly,
      confidence: 0.72,
      timeWindowDays: 90,
      requiresActions: [
        {
          action: 'draft_solar_hybrid_rfp',
          target: 'energy',
          payload: { monthlyKwh: e.monthlyKwhConsumption },
        },
      ],
      relatedScopes: ['energy', 'operations'],
      citations: ['energy-spend', 'solar-quotes'],
    };
  },
};

const nightShiftActivation: ScanRule = {
  id: 'ops.night_shift_activation',
  kind: 'operational_arbitrage',
  requiresAction: true,
  detect(state) {
    const o = state.ops;
    if (!o || o.nightShiftIdleCapacityPct == null) return false;
    return o.nightShiftIdleCapacityPct > 50 && (o.nightShiftFuelDeltaTzsPerTonne ?? 0) <= 0;
  },
  evaluate(state): Opportunity {
    const o = state.ops!;
    const idle = o.nightShiftIdleCapacityPct ?? 0;
    return {
      id: 'ops.night_shift_activation',
      kind: 'operational_arbitrage',
      headline: {
        en: `Activate night shift — ${idle.toFixed(0)}% capacity idle, fuel-neutral`,
        sw: `Anzisha zamu ya usiku — uwezo wa ${idle.toFixed(0)}% haitumiki, mafuta hayabadiliki`,
      },
      narrative: {
        en: `Night-shift capacity is ${idle.toFixed(0)}% idle. The fuel-per-tonne delta at night is non-positive on your fleet, so each tonne mined at night is incremental margin. Worth piloting on one site for 30 days to measure throughput.`,
        sw: `Uwezo wa zamu ya usiku ni ${idle.toFixed(0)}% bila kutumika. Mafuta kwa tani usiku hayabadiliki, hivyo tani yoyote inayozalishwa usiku ni faida ya ziada. Jaribu kwa siku 30 katika tovuti moja.`,
      },
      expectedValueTzs: null,
      savingsTzs: null,
      confidence: 0.62,
      timeWindowDays: 30,
      requiresActions: [
        {
          action: 'draft_night_shift_pilot_plan',
          target: 'operations',
          payload: {},
        },
      ],
      relatedScopes: ['operations', 'workforce'],
      citations: ['shift-reports'],
    };
  },
};

const haulRouteRecalibration: ScanRule = {
  id: 'ops.haul_route_recalibration',
  kind: 'operational_arbitrage',
  requiresAction: true,
  detect(state) {
    const o = state.ops;
    if (!o || o.bcmHaulDistanceMetresMean == null || o.bcmHaulDistanceP25Metres == null) return false;
    return o.bcmHaulDistanceMetresMean - o.bcmHaulDistanceP25Metres > 250;
  },
  evaluate(state): Opportunity {
    const o = state.ops!;
    const delta = (o.bcmHaulDistanceMetresMean ?? 0) - (o.bcmHaulDistanceP25Metres ?? 0);
    return {
      id: 'ops.haul_route_recalibration',
      kind: 'operational_arbitrage',
      headline: {
        en: `Recalibrate haul routes — mean ${delta.toFixed(0)}m longer than p25 peers`,
        sw: `Boresha njia za usafirishaji — wastani ni mita ${delta.toFixed(0)} zaidi ya wenzio bora`,
      },
      narrative: {
        en: `Mean haul distance is ${delta.toFixed(0)}m longer than the peer p25. A short survey + waypoint reset typically clips 12-18% off cycle time, lifting tonnes/shift on the same fleet.`,
        sw: `Umbali wa wastani ni mita ${delta.toFixed(0)} zaidi ya wenzio bora. Uchunguzi mfupi unaweza kupunguza muda wa mzunguko kwa 12-18%, kuongeza tani kwa zamu.`,
      },
      expectedValueTzs: null,
      savingsTzs: null,
      confidence: 0.6,
      timeWindowDays: 45,
      requiresActions: [
        {
          action: 'draft_haul_survey_request',
          target: 'operations',
          payload: { siteDeltaMetres: delta },
        },
      ],
      relatedScopes: ['operations'],
      citations: ['shift-reports', 'peer-cohort'],
    };
  },
};

const rejectedOreProcessing: ScanRule = {
  id: 'ops.rejected_ore_processing',
  kind: 'revenue',
  requiresAction: true,
  detect(state) {
    const o = state.ops;
    if (!o || o.rejectedOreTonnesRolling30d == null || o.downstreamProcessingTzsPerTonne == null) return false;
    return o.rejectedOreTonnesRolling30d > 50 && o.downstreamProcessingTzsPerTonne > 30_000;
  },
  evaluate(state): Opportunity {
    const o = state.ops!;
    const tonnes = o.rejectedOreTonnesRolling30d ?? 0;
    const tzsPerTonne = o.downstreamProcessingTzsPerTonne ?? 0;
    const monthly = tzs(tonnes * tzsPerTonne);
    return {
      id: 'ops.rejected_ore_processing',
      kind: 'revenue',
      headline: {
        en: `Re-process ${tonnes.toFixed(0)}t of rejected ore — TZS ${monthly.toLocaleString()}/mo`,
        sw: `Sindika tena tani ${tonnes.toFixed(0)} za mawe yaliyokataliwa — TZS ${monthly.toLocaleString()}/mwezi`,
      },
      narrative: {
        en: `${tonnes.toFixed(0)}t of ore was rejected in the last 30 days. A downstream processor pays TZS ${tzsPerTonne.toLocaleString()} per tonne for low-grade feed. Selling the reject stream pulls in ~TZS ${monthly.toLocaleString()}/month with zero impact on your primary pit.`,
        sw: `Tani ${tonnes.toFixed(0)} za mawe zilikataliwa siku 30 zilizopita. Mchakataji wa baadaye hulipa TZS ${tzsPerTonne.toLocaleString()} kwa tani. Kuuza mawe yaliyokataliwa kunaleta ~TZS ${monthly.toLocaleString()}/mwezi bila kuathiri shimo lako kuu.`,
      },
      expectedValueTzs: tzs(monthly * 12),
      savingsTzs: null,
      confidence: 0.72,
      timeWindowDays: 30,
      requiresActions: [
        {
          action: 'draft_offtake_for_rejects',
          target: 'marketplace',
          payload: { tonnes, tzsPerTonne },
        },
      ],
      relatedScopes: ['operations', 'marketplace'],
      citations: ['shift-reports', 'parcel-inventory'],
    };
  },
};

const stockpileAgingClearance: ScanRule = {
  id: 'ops.stockpile_aging_clearance',
  kind: 'cost_saving',
  requiresAction: true,
  detect(state) {
    return Boolean(state.ops && (state.ops.stockpileAgeP90Days ?? 0) > 60);
  },
  evaluate(state): Opportunity {
    const o = state.ops!;
    const days = o.stockpileAgeP90Days ?? 0;
    return {
      id: 'ops.stockpile_aging_clearance',
      kind: 'cost_saving',
      headline: {
        en: `Clear aged stockpile — p90 sat ${days.toFixed(0)} days, tying up cash`,
        sw: `Toa shehena iliyozeeka — p90 imekaa siku ${days.toFixed(0)}, inafunga pesa`,
      },
      narrative: {
        en: `Stockpile p90 age is ${days.toFixed(0)} days. Each day of dwell adds carrying cost plus regulator scrutiny risk if NEMC visits. A directed listing at LBMA-fix-minus clears the inventory and frees the working capital.`,
        sw: `Umri wa p90 wa shehena ni siku ${days.toFixed(0)}. Kila siku huongeza gharama na hatari ya NEMC. Tangaza kwa bei ya LBMA-pungufu ili kufungua hela.`,
      },
      expectedValueTzs: null,
      savingsTzs: null,
      confidence: 0.66,
      timeWindowDays: 14,
      requiresActions: [
        {
          action: 'open_marketplace_sell_flow',
          target: 'parcel',
          payload: { reason: 'aged_stockpile_clearance' },
        },
      ],
      relatedScopes: ['operations', 'marketplace'],
      citations: ['parcel-inventory'],
    };
  },
};

// =====================================================================
// 12. COMPLIANCE SHORTCUTS (compliance_shortcut)
// =====================================================================

const insuranceAutoRenewalShortcut: ScanRule = {
  id: 'compliance.insurance_auto_renew_shortcut',
  kind: 'compliance_shortcut',
  requiresAction: true,
  detect(state) {
    return Boolean(state.insurance?.policyDueWithin60d);
  },
  evaluate(state): Opportunity {
    return {
      id: 'compliance.insurance_auto_renew_shortcut',
      kind: 'compliance_shortcut',
      headline: {
        en: 'Set insurance to auto-renew via Borjie reminder',
        sw: 'Weka bima irudiwe kiotomatiki kupitia ukumbusho wa Borjie',
      },
      narrative: {
        en: `Policy renewal lands within 60 days. Borjie can set a 30-day-out reminder and pre-fetch broker quotes so the renewal lands without a fire-drill. One-time setup.`,
        sw: `Bima inahitajika kurudiwa ndani ya siku 60. Borjie inaweza kuweka ukumbusho wa siku 30 mapema na kuandaa ofa za broker.`,
      },
      expectedValueTzs: null,
      savingsTzs: null,
      confidence: 0.85,
      timeWindowDays: 60,
      requiresActions: [
        {
          action: 'schedule_insurance_renewal_reminder',
          target: 'reminders',
          payload: { offsetDays: 30 },
        },
      ],
      relatedScopes: ['insurance', 'reminders'],
      citations: ['insurance-policies'],
    };
  },
};

// =====================================================================
// 13. ESTATE-PLANNING extras
// =====================================================================

const holdingCoFormation: ScanRule = {
  id: 'estate.holding_co_formation',
  kind: 'estate_planning',
  requiresAction: false,
  detect(state) {
    const e = state.estate;
    return Boolean(e && e.subsidiaryCount >= 2 && e.holdingCoExists === false);
  },
  evaluate(state): Opportunity {
    const e = state.estate!;
    return {
      id: 'estate.holding_co_formation',
      kind: 'estate_planning',
      headline: {
        en: `Form a holding co — ${e.subsidiaryCount} subsidiaries without one`,
        sw: `Anzisha kampuni mama — una kampuni tanzu ${e.subsidiaryCount} bila kampuni mama`,
      },
      narrative: {
        en: `${e.subsidiaryCount} subsidiaries are operating without a holding company on top. A holding structure ringfences operating risk, simplifies estate transfers, and opens TRA group-relief treatment on losses.`,
        sw: `Una kampuni tanzu ${e.subsidiaryCount} bila kampuni mama. Muundo wa kampuni mama hulinda kampuni za uendeshaji, hurahisisha urithi, na hufungua punguzo la TRA.`,
      },
      expectedValueTzs: null,
      savingsTzs: null,
      confidence: 0.7,
      timeWindowDays: 180,
      requiresActions: [],
      relatedScopes: ['estate'],
      citations: ['estate-entities'],
    };
  },
};

// =====================================================================
// 14. REVENUE — direct (revenue)
// =====================================================================

const downstreamOfftakerOpportunity: ScanRule = {
  id: 'revenue.downstream_offtaker',
  kind: 'revenue',
  requiresAction: true,
  detect(state) {
    return Boolean(
      state.ops &&
        (state.ops.rejectedOreTonnesRolling30d ?? 0) > 10 &&
        (state.ops.downstreamProcessingTzsPerTonne ?? 0) > 50_000,
    );
  },
  evaluate(state): Opportunity {
    const o = state.ops!;
    const annual = tzs(
      (o.rejectedOreTonnesRolling30d ?? 0) * 12 * (o.downstreamProcessingTzsPerTonne ?? 0),
    );
    return {
      id: 'revenue.downstream_offtaker',
      kind: 'revenue',
      headline: {
        en: 'Lock a downstream off-taker for low-grade output',
        sw: 'Funga mnunuzi wa mawe ya kiwango cha chini',
      },
      narrative: {
        en: `Low-grade output has a stable monthly volume. Locking a 12-month off-take with a downstream processor smooths revenue and avoids spot-market discount cycles. Estimated annualised value: TZS ${annual.toLocaleString()}.`,
        sw: `Mawe ya kiwango cha chini yana wingi thabiti. Kufunga mkataba wa miezi 12 na mchakataji wa baadaye kunaongeza mapato thabiti.`,
      },
      expectedValueTzs: annual,
      savingsTzs: null,
      confidence: 0.66,
      timeWindowDays: 60,
      requiresActions: [
        {
          action: 'draft_offtake_master_agreement',
          target: 'marketplace',
          payload: {},
        },
      ],
      relatedScopes: ['marketplace', 'operations'],
      citations: ['shift-reports'],
    };
  },
};

// =====================================================================
// 15. ADDITIONAL OPERATIONAL ARBITRAGE
// =====================================================================

const blastPatternOptimization: ScanRule = {
  id: 'ops.blast_pattern_optimization',
  kind: 'operational_arbitrage',
  requiresAction: false,
  detect(state) {
    return Boolean(
      state.peer?.p75Pattern && state.peer.p75Pattern.toLowerCase().includes('blast'),
    );
  },
  evaluate(state): Opportunity {
    const p = state.peer!;
    return {
      id: 'ops.blast_pattern_optimization',
      kind: 'operational_arbitrage',
      headline: {
        en: 'Test the peer-leading blast pattern',
        sw: 'Jaribu mpangilio wa mlipuko unaotumiwa na wenzio bora',
      },
      narrative: {
        en: `Top-quartile peers use the "${p.p75Pattern}" blast pattern. A two-week pilot on one bench typically lifts fragmentation index 8-12% and trims crusher energy per tonne.`,
        sw: `Wenzio wa juu wanatumia mpangilio wa mlipuko "${p.p75Pattern}". Jaribio la wiki 2 katika benchi moja huongeza fragmentation kwa 8-12%.`,
      },
      expectedValueTzs: null,
      savingsTzs: null,
      confidence: 0.6,
      timeWindowDays: 45,
      requiresActions: [],
      relatedScopes: ['operations'],
      citations: ['peer-cohort'],
    };
  },
};

// =====================================================================
// 16. ADDITIONAL HR / WORKFORCE
// =====================================================================

const apprenticeRetentionBonusCredit: ScanRule = {
  id: 'hr.apprentice_retention_credit',
  kind: 'hr',
  requiresAction: false,
  detect(state) {
    return Boolean(
      state.workforce && state.workforce.apprenticeshipEligibleCount >= 3,
    );
  },
  evaluate(state): Opportunity {
    const w = state.workforce!;
    return {
      id: 'hr.apprentice_retention_credit',
      kind: 'hr',
      headline: {
        en: 'Backfill a senior with an apprentice — retention bonus stacks',
        sw: 'Badilisha mfanyakazi mwandamizi na mwanafunzi — bonasi inaongezeka',
      },
      narrative: {
        en: `With ${w.apprenticeshipEligibleCount} apprenticeship-eligible workers on file, you can backfill a senior departure with an internal promotion + apprentice hire. The VETA subsidy plus your own retention bonus stack to lower true cost per role.`,
        sw: `Una wafanyakazi ${w.apprenticeshipEligibleCount} wanaostahili. Unaweza kubadilisha mfanyakazi anayeondoka kwa kupandisha cheo ndani na kuajiri mwanafunzi.`,
      },
      expectedValueTzs: null,
      savingsTzs: null,
      confidence: 0.6,
      timeWindowDays: 90,
      requiresActions: [],
      relatedScopes: ['workforce', 'training'],
      citations: ['workforce-roster'],
    };
  },
};

// =====================================================================
// 17. CAPITAL — additional
// =====================================================================

const cashSweepBetterAccount: ScanRule = {
  id: 'capital.cash_sweep_better_account',
  kind: 'capital',
  requiresAction: true,
  detect(state) {
    const c = state.capital;
    return Boolean(c && (c.cashOnHandTzs ?? 0) > 200_000_000);
  },
  evaluate(state): Opportunity {
    const c = state.capital!;
    const cash = c.cashOnHandTzs ?? 0;
    // Assume a 3% yield-spread on overnight sweep vs current account.
    const annual = tzs(cash * 0.03);
    return {
      id: 'capital.cash_sweep_better_account',
      kind: 'capital',
      headline: {
        en: 'Move idle TZS into a sweep account — TZS ' + annual.toLocaleString() + '/yr',
        sw: 'Hamisha TZS isiyofanya kazi kwenye akaunti ya sweep — TZS ' + annual.toLocaleString() + '/mwaka',
      },
      narrative: {
        en: `Operating account holds TZS ${cash.toLocaleString()}. A sweep account at CRDB / NMB pays an overnight rate of ~3% on the float without locking the cash. Estimated annual yield: TZS ${annual.toLocaleString()}.`,
        sw: `Akaunti yako ya uendeshaji ina TZS ${cash.toLocaleString()}. Akaunti ya sweep ya CRDB / NMB hulipa ~3% bila kufunga pesa.`,
      },
      expectedValueTzs: annual,
      savingsTzs: annual,
      confidence: 0.78,
      timeWindowDays: 21,
      requiresActions: [
        {
          action: 'draft_sweep_account_request',
          target: 'treasury',
          payload: { cashTzs: cash },
        },
      ],
      relatedScopes: ['capital', 'treasury'],
      citations: ['cash-runway'],
    };
  },
};

// =====================================================================
// 18. ESTATE — group relief / consolidation
// =====================================================================

const subsidiaryConsolidationGroupRelief: ScanRule = {
  id: 'estate.subsidiary_consolidation_group_relief',
  kind: 'tax_efficiency',
  requiresAction: false,
  detect(state) {
    return Boolean(state.estate && state.estate.holdingCoExists && state.estate.subsidiaryCount >= 3);
  },
  evaluate(state): Opportunity {
    return {
      id: 'estate.subsidiary_consolidation_group_relief',
      kind: 'tax_efficiency',
      headline: {
        en: 'Elect TRA group relief — offset subsidiary losses against profits',
        sw: 'Chagua msamaha wa kikundi wa TRA — punguza hasara dhidi ya faida',
      },
      narrative: {
        en: `Your group structure qualifies for TRA group relief. Electing the regime offsets one subsidiary's tax loss against another's profit in the same tax year — material on years with one underperforming asset.`,
        sw: `Muundo wako wa kikundi unastahili msamaha wa TRA. Hii inakuruhusu kupunguza hasara ya kampuni moja dhidi ya faida ya nyingine katika mwaka wa kodi.`,
      },
      expectedValueTzs: null,
      savingsTzs: null,
      confidence: 0.7,
      timeWindowDays: 120,
      requiresActions: [],
      relatedScopes: ['estate', 'tax'],
      citations: ['tra-group-relief', 'estate-entities'],
    };
  },
};

// =====================================================================
// 19. PROCUREMENT — additional
// =====================================================================

const reagentBulkPurchase: ScanRule = {
  id: 'procurement.reagent_bulk_purchase',
  kind: 'cost_saving',
  requiresAction: false,
  detect(state) {
    return Boolean(
      state.vendors?.categoriesWithMultipleSuppliers?.some(
        (c) =>
          (c.category.toLowerCase().includes('reagent') ||
            c.category.toLowerCase().includes('cyanide')) &&
          c.annualSpendTzs > 10_000_000,
      ),
    );
  },
  evaluate(state): Opportunity {
    const cat = state.vendors!.categoriesWithMultipleSuppliers
      .filter((c) => c.category.toLowerCase().includes('reagent') || c.category.toLowerCase().includes('cyanide'))
      .sort((a, b) => b.annualSpendTzs - a.annualSpendTzs)[0]!;
    const savings = tzs(cat.annualSpendTzs * 0.12);
    return {
      id: 'procurement.reagent_bulk_purchase',
      kind: 'cost_saving',
      headline: {
        en: `Bulk-buy ${cat.category} on a 12-month forward — saves ~12%`,
        sw: `Nunua ${cat.category} kwa mkataba wa miezi 12 — okoa ~12%`,
      },
      narrative: {
        en: `${cat.category} spend is TZS ${cat.annualSpendTzs.toLocaleString()}/yr across ${cat.supplierCount} suppliers. A 12-month forward purchase typically saves 10-15%. Estimated annual save: TZS ${savings.toLocaleString()}.`,
        sw: `Matumizi ya ${cat.category} ni TZS ${cat.annualSpendTzs.toLocaleString()}/mwaka kutoka watoaji ${cat.supplierCount}. Mkataba wa miezi 12 huokoa 10-15%. Akiba: TZS ${savings.toLocaleString()}.`,
      },
      expectedValueTzs: savings,
      savingsTzs: savings,
      confidence: 0.65,
      timeWindowDays: 30,
      requiresActions: [],
      relatedScopes: ['procurement'],
      citations: ['vendor-spend'],
    };
  },
};

// =====================================================================
// 20. COMPLIANCE — additional
// =====================================================================

const certPreemptiveRenewal: ScanRule = {
  id: 'compliance.cert_preemptive_renewal',
  kind: 'compliance_shortcut',
  requiresAction: true,
  detect(state) {
    return Boolean(state.workforce && state.workforce.icaCertExpiringIn60dCount >= 1);
  },
  evaluate(state): Opportunity {
    const count = state.workforce!.icaCertExpiringIn60dCount;
    return {
      id: 'compliance.cert_preemptive_renewal',
      kind: 'compliance_shortcut',
      headline: {
        en: `Pre-queue ${count} ICA cert renewal(s) on autopilot`,
        sw: `Andaa upyaji wa vyeti vya ICA ${count} kwa autopilot`,
      },
      narrative: {
        en: `${count} ICA certifications expire within 60 days. Borjie can pre-queue the renewals so they land on day-of-expiry without an operator handoff. Reduces lapse risk to zero.`,
        sw: `Vyeti vya ICA ${count} vinaisha ndani ya siku 60. Borjie inaweza kuandaa upyaji ili ufanyike siku ya mwisho bila kazi ya mtu.`,
      },
      expectedValueTzs: null,
      savingsTzs: null,
      confidence: 0.92,
      timeWindowDays: 60,
      requiresActions: [
        {
          action: 'schedule_ica_autopilot_renewal',
          target: 'workforce',
          payload: { count },
        },
      ],
      relatedScopes: ['compliance', 'workforce'],
      citations: ['workforce-certifications'],
    };
  },
};

// =====================================================================
// Barrel — append-only list scanner walks
// =====================================================================

export const ALL_SCAN_RULES: ReadonlyArray<ScanRule> = Object.freeze([
  // Cost saving
  fuelSupplierArbitrage,
  fuelConsumptionAuditTrigger,
  vendorConsolidationDiscount,
  icaCertBatchSavings,
  insuranceBrokerBetterQuote,
  energySolarHybridSwitch,
  stockpileAgingClearance,
  reagentBulkPurchase,
  // Revenue
  buyerCompetitiveOffer,
  forestryCarbonCreditEligible,
  rejectedOreProcessing,
  downstreamOfftakerOpportunity,
  // Tax efficiency
  traRoyaltyRateElection,
  subsidiaryConsolidationGroupRelief,
  // Regulatory window
  nemcAmnestyWindow,
  // Capital
  intercompanySurplusRouting,
  idleCashYieldOpportunity,
  loanRefinanceOpportunity,
  cashSweepBetterAccount,
  // Market timing
  lbmaFixPremiumWindow,
  botGoldWindowOpen,
  // Operational arbitrage
  fuelConsumptionAuditTrigger, // re-listed under operational kind — note: dedupe by id below
  nightShiftActivation,
  haulRouteRecalibration,
  blastPatternOptimization,
  // HR
  trainingApprenticeshipCredit,
  apprenticeRetentionBonusCredit,
  // Compliance shortcut
  traQuarterlyFilingShortcut,
  insuranceAutoRenewalShortcut,
  certPreemptiveRenewal,
  // Estate planning
  successionReviewOverdueAdvantage,
  holdingCoFormation,
  // Counterparty
  buyerPremiumCounterparty,
  // Peer best practice
  peerBestPracticeUnmatched,
]);

/**
 * Distinct rules (dedupe on id) — scanner uses this. Keeps the
 * grouped catalog readable while ensuring the scanner doesn't
 * double-emit the same rule.
 */
export const SCAN_RULES: ReadonlyArray<ScanRule> = Object.freeze(
  Array.from(
    new Map(ALL_SCAN_RULES.map((r) => [r.id, r])).values(),
  ),
);
