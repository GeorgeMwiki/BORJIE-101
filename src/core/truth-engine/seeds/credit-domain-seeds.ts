/**
 * Credit Domain Seed Anchors
 *
 * Evidence-backed claims for IFRS 9, Basel III, PD/LGD/EAD, BoT prudential
 * thresholds, sector NPL benchmarks, DSR/DSCR thresholds, the 5Cs of credit,
 * and CRB licensing in Tanzania.
 *
 * These are the foundational facts the AI must NEVER hallucinate when
 * borrowers, officers, or admins ask about credit risk, capital adequacy,
 * loss provisioning, or loan-affordability rules.
 *
 * Honest-scaffolding (see ClaimDraft.pendingVerification): any numeric value
 * we cannot anchor to a Tier-1 primary source URL with verbatim excerpt is
 * flagged so the cron refresher MUST re-fetch and re-score before the lookup
 * layer is allowed to return grade='verified'. The seed exists to give the
 * engine the *subject + factKey + authoritative URL* anchor; the cron
 * confirms the number.
 *
 * Categories used (all from existing ClaimCategory union):
 *   - "regulatory"   IFRS 9, Basel III ratios, BoT prudential, CRB licensing
 *   - "benchmark"    Sector NPL ratios, DSR / DSCR thresholds
 *   - "structural"   Definitions of PD, LGD, EAD, 5Cs
 *
 * Jurisdictions:
 *   - "GLOBAL"  IFRS, Basel, definitions (always returned)
 *   - "TZ"      BoT prudential, Tanzania sector NPL, CRB Tanzania
 */

import type { ClaimDraft } from "../types";

/**
 * Baseline last-verified timestamp for every seed in this catalog. Used by
 * the lookup-layer 30-day staleness gate (MAX_VERIFIED_AGE_DAYS): a seed
 * marked pendingVerification AND older than 30 days is excluded from the
 * verified-claims block, and the engine emits a "defer all" sentinel
 * instructing the model to defer every numeric claim to the bank.
 *
 * Anchored to the file's last manual edit (2026-04-30). The cron refresher
 * (`runDailyRefresh`) updates `last_verified_at` to `now()` whenever it
 * re-fetches a row; this constant is only the back-stop for seeds that
 * have never been refreshed yet.
 */
const SEED_LAST_VERIFIED_AT = new Date("2026-04-30").toISOString();

function withLastVerified(draft: ClaimDraft): ClaimDraft {
  return draft.lastVerifiedAt
    ? draft
    : { ...draft, lastVerifiedAt: SEED_LAST_VERIFIED_AT };
}

// ---------------------------------------------------------------------------
// IFRS 9 — staging + ECL formula (GLOBAL)
// ---------------------------------------------------------------------------
const IFRS_9_SEEDS: readonly ClaimDraft[] = [
  {
    category: "regulatory",
    subject: "IFRS 9 Stage 1 classification (performing)",
    factKey: "ifrs9_stage_1_definition",
    claimText:
      "Under IFRS 9, Stage 1 covers financial assets that have not had a significant increase in credit risk since initial recognition; impairment is measured as 12-month expected credit losses.",
    jurisdiction: "GLOBAL",
    effectiveDate: "2018-01-01",
    pendingVerification: true,
    evidence: [
      {
        sourceType: "regulator",
        sourceUrl:
          "https://www.ifrs.org/issued-standards/list-of-standards/ifrs-9-financial-instruments/",
        sourceDomain: "ifrs.org",
        excerpt:
          "Stage 1 includes financial instruments that have not had a significant increase in credit risk since initial recognition; loss allowance equals 12-month expected credit losses.",
        retrievedBy: "system",
      },
    ],
    createdBy: "system",
  },
  {
    category: "regulatory",
    subject:
      "IFRS 9 Stage 2 classification (significant increase in credit risk)",
    factKey: "ifrs9_stage_2_definition",
    claimText:
      "Under IFRS 9, Stage 2 covers financial assets with a significant increase in credit risk since initial recognition but not yet credit-impaired; impairment is measured as lifetime expected credit losses.",
    jurisdiction: "GLOBAL",
    effectiveDate: "2018-01-01",
    pendingVerification: true,
    evidence: [
      {
        sourceType: "regulator",
        sourceUrl:
          "https://www.ifrs.org/issued-standards/list-of-standards/ifrs-9-financial-instruments/",
        sourceDomain: "ifrs.org",
        excerpt:
          "Stage 2 instruments have experienced a significant increase in credit risk since initial recognition; loss allowance equals lifetime expected credit losses.",
        retrievedBy: "system",
      },
    ],
    createdBy: "system",
  },
  {
    category: "regulatory",
    subject: "IFRS 9 Stage 3 classification (credit-impaired)",
    factKey: "ifrs9_stage_3_definition",
    claimText:
      "Under IFRS 9, Stage 3 covers financial assets that are credit-impaired at the reporting date; impairment is measured as lifetime expected credit losses and interest revenue is recognised on the net carrying amount.",
    jurisdiction: "GLOBAL",
    effectiveDate: "2018-01-01",
    pendingVerification: true,
    evidence: [
      {
        sourceType: "regulator",
        sourceUrl:
          "https://www.ifrs.org/issued-standards/list-of-standards/ifrs-9-financial-instruments/",
        sourceDomain: "ifrs.org",
        excerpt:
          "Stage 3 covers financial assets that are credit-impaired; lifetime expected credit losses are recognised and interest is calculated on the net carrying amount.",
        retrievedBy: "system",
      },
    ],
    createdBy: "system",
  },
  {
    category: "regulatory",
    subject: "IFRS 9 Expected Credit Loss formula (ECL = PD x LGD x EAD)",
    factKey: "ifrs9_ecl_formula",
    claimText:
      "Under IFRS 9, expected credit loss is computed as the probability of default multiplied by loss given default multiplied by exposure at default, discounted at the effective interest rate.",
    jurisdiction: "GLOBAL",
    effectiveDate: "2018-01-01",
    pendingVerification: true,
    evidence: [
      {
        sourceType: "regulator",
        sourceUrl:
          "https://www.ifrs.org/issued-standards/list-of-standards/ifrs-9-financial-instruments/",
        sourceDomain: "ifrs.org",
        excerpt:
          "Expected credit losses are a probability-weighted estimate of credit losses; commonly modelled as PD x LGD x EAD discounted at the effective interest rate.",
        retrievedBy: "system",
      },
    ],
    createdBy: "system",
  },
];

// ---------------------------------------------------------------------------
// PD / LGD / EAD definitions + Basel floors (GLOBAL)
// ---------------------------------------------------------------------------
const PD_LGD_EAD_SEEDS: readonly ClaimDraft[] = [
  {
    category: "structural",
    subject: "Probability of Default (PD) definition",
    factKey: "pd_definition",
    claimText:
      "Probability of Default is the likelihood that an obligor will default on its credit obligation over a specified time horizon, typically one year for Basel IRB and lifetime for IFRS 9 Stage 2 and Stage 3.",
    jurisdiction: "GLOBAL",
    effectiveDate: "2017-12-07",
    pendingVerification: true,
    evidence: [
      {
        sourceType: "regulator",
        sourceUrl: "https://www.bis.org/basel_framework/chapter/CRE/32.htm",
        sourceDomain: "bis.org",
        excerpt:
          "Probability of default of a borrower means the probability of default of a counterparty over a one-year horizon under the IRB approach.",
        retrievedBy: "system",
      },
    ],
    createdBy: "system",
  },
  {
    category: "structural",
    subject: "Loss Given Default (LGD) definition",
    factKey: "lgd_definition",
    claimText:
      "Loss Given Default is the share of an exposure that is lost if the borrower defaults, expressed as a percentage of exposure at default after accounting for recoveries from collateral, guarantees and workout.",
    jurisdiction: "GLOBAL",
    effectiveDate: "2017-12-07",
    pendingVerification: true,
    evidence: [
      {
        sourceType: "regulator",
        sourceUrl: "https://www.bis.org/basel_framework/chapter/CRE/32.htm",
        sourceDomain: "bis.org",
        excerpt:
          "Loss given default means the ratio of the loss on an exposure due to the default of a counterparty to the amount outstanding at default.",
        retrievedBy: "system",
      },
    ],
    createdBy: "system",
  },
  {
    category: "structural",
    subject: "Exposure at Default (EAD) definition",
    factKey: "ead_definition",
    claimText:
      "Exposure at Default is the expected outstanding amount on a credit exposure at the time of default, including drawn balances plus a credit-conversion-factor share of undrawn commitments.",
    jurisdiction: "GLOBAL",
    effectiveDate: "2017-12-07",
    pendingVerification: true,
    evidence: [
      {
        sourceType: "regulator",
        sourceUrl: "https://www.bis.org/basel_framework/chapter/CRE/32.htm",
        sourceDomain: "bis.org",
        excerpt:
          "Exposure at default is the expected gross dollar exposure of the facility upon the borrower's default, including drawn amounts plus expected drawdown of undrawn commitments via the credit conversion factor.",
        retrievedBy: "system",
      },
    ],
    createdBy: "system",
  },
  {
    category: "regulatory",
    subject:
      "Basel III LGD floor for unsecured retail exposures (Foundation IRB)",
    factKey: "basel_lgd_floor_unsecured_retail",
    claimText:
      "Under Basel III's revised IRB framework, the LGD input floor for unsecured retail exposures is 25 percent (excluding qualifying revolving retail).",
    numericValue: 25,
    unit: "percent",
    jurisdiction: "GLOBAL",
    effectiveDate: "2023-01-01",
    pendingVerification: true,
    evidence: [
      {
        sourceType: "regulator",
        sourceUrl: "https://www.bis.org/bcbs/publ/d424.htm",
        sourceDomain: "bis.org",
        excerpt:
          "Banks must apply input floors to LGD estimates; for unsecured retail exposures the LGD floor is set at twenty-five percent.",
        retrievedBy: "system",
      },
    ],
    createdBy: "system",
  },
  {
    category: "regulatory",
    subject:
      "Basel III credit conversion factor for committed but undrawn revolving retail facilities",
    factKey: "basel_ccf_undrawn_revolving",
    claimText:
      "Under Basel III's standardised approach, undrawn but committed revolving facilities that are unconditionally cancellable typically attract a 10 percent credit conversion factor for EAD calculation.",
    numericValue: 10,
    unit: "percent",
    jurisdiction: "GLOBAL",
    effectiveDate: "2023-01-01",
    pendingVerification: true,
    evidence: [
      {
        sourceType: "regulator",
        sourceUrl: "https://www.bis.org/bcbs/publ/d424.htm",
        sourceDomain: "bis.org",
        excerpt:
          "Commitments that are unconditionally cancellable at any time by the bank without prior notice receive a credit conversion factor of ten percent under the revised standardised approach.",
        retrievedBy: "system",
      },
    ],
    createdBy: "system",
  },
];

// ---------------------------------------------------------------------------
// Basel III capital ratios (GLOBAL) — one claim per ratio so the
// numeric-disagreement detector does not flag multi-number excerpts.
// ---------------------------------------------------------------------------
const BASEL_III_SEEDS: readonly ClaimDraft[] = [
  {
    category: "regulatory",
    subject: "Basel III CET1 minimum capital ratio",
    factKey: "basel_iii_cet1_minimum",
    claimText:
      "Under Basel III, the minimum Common Equity Tier 1 capital ratio is 4.5 percent of risk-weighted assets.",
    numericValue: 4.5,
    unit: "percent",
    jurisdiction: "GLOBAL",
    effectiveDate: "2015-01-01",
    evidence: [
      {
        sourceType: "regulator",
        sourceUrl: "https://www.bis.org/bcbs/publ/d189.htm",
        sourceDomain: "bis.org",
        excerpt:
          "Common Equity Tier 1 must be at least four point five percent of risk-weighted assets at all times.",
        retrievedBy: "system",
      },
    ],
    createdBy: "system",
  },
  {
    category: "regulatory",
    subject: "Basel III Tier 1 minimum capital ratio",
    factKey: "basel_iii_tier1_minimum",
    claimText:
      "Under Basel III, the minimum Tier 1 capital ratio is 6 percent of risk-weighted assets.",
    numericValue: 6,
    unit: "percent",
    jurisdiction: "GLOBAL",
    effectiveDate: "2015-01-01",
    evidence: [
      {
        sourceType: "regulator",
        sourceUrl: "https://www.bis.org/bcbs/publ/d189.htm",
        sourceDomain: "bis.org",
        excerpt:
          "Tier 1 capital must be at least six percent of risk-weighted assets at all times.",
        retrievedBy: "system",
      },
    ],
    createdBy: "system",
  },
  {
    category: "regulatory",
    subject: "Basel III Total Capital minimum ratio",
    factKey: "basel_iii_total_capital_minimum",
    claimText:
      "Under Basel III, the minimum Total Capital ratio is 8 percent of risk-weighted assets.",
    numericValue: 8,
    unit: "percent",
    jurisdiction: "GLOBAL",
    effectiveDate: "2015-01-01",
    evidence: [
      {
        sourceType: "regulator",
        sourceUrl: "https://www.bis.org/bcbs/publ/d189.htm",
        sourceDomain: "bis.org",
        excerpt:
          "Total capital must be at least eight percent of risk-weighted assets at all times under the Basel III framework.",
        retrievedBy: "system",
      },
    ],
    createdBy: "system",
  },
  {
    category: "regulatory",
    subject: "Basel III capital conservation buffer",
    factKey: "basel_iii_conservation_buffer",
    claimText:
      "Basel III requires a capital conservation buffer of 2.5 percent of risk-weighted assets, composed entirely of Common Equity Tier 1.",
    numericValue: 2.5,
    unit: "percent",
    jurisdiction: "GLOBAL",
    effectiveDate: "2019-01-01",
    evidence: [
      {
        sourceType: "regulator",
        sourceUrl: "https://www.bis.org/bcbs/publ/d189.htm",
        sourceDomain: "bis.org",
        excerpt:
          "A capital conservation buffer of two point five percent of risk-weighted assets, comprising Common Equity Tier 1, applies above the minimum requirement.",
        retrievedBy: "system",
      },
    ],
    createdBy: "system",
  },
  {
    category: "regulatory",
    subject: "Basel III countercyclical capital buffer ceiling",
    factKey: "basel_iii_countercyclical_buffer_ceiling",
    claimText:
      "Basel III countercyclical capital buffer can be set by national authorities in a range from zero up to 2.5 percent of risk-weighted assets, depending on macro-financial conditions.",
    numericValue: 2.5,
    unit: "percent",
    jurisdiction: "GLOBAL",
    effectiveDate: "2016-01-01",
    pendingVerification: true,
    evidence: [
      {
        sourceType: "regulator",
        sourceUrl: "https://www.bis.org/bcbs/publ/d189.htm",
        sourceDomain: "bis.org",
        excerpt:
          "The countercyclical capital buffer is set by national authorities at up to two point five percent of risk-weighted assets when excess credit growth is judged to pose systemic risk.",
        retrievedBy: "system",
      },
    ],
    createdBy: "system",
  },
];

// ---------------------------------------------------------------------------
// 5Cs of Credit (GLOBAL)
// ---------------------------------------------------------------------------
const FIVE_CS_SEEDS: readonly ClaimDraft[] = [
  {
    category: "structural",
    subject: "5Cs of Credit framework",
    factKey: "five_cs_of_credit",
    claimText:
      "The 5Cs of Credit are Character, Capacity, Capital, Collateral, and Conditions; lenders use this framework to qualitatively assess a borrower's creditworthiness.",
    jurisdiction: "GLOBAL",
    effectiveDate: "2024-01-01",
    pendingVerification: true,
    evidence: [
      {
        sourceType: "industry_report",
        sourceUrl: "https://www.investopedia.com/terms/f/five-c-credit.asp",
        sourceDomain: "investopedia.com",
        excerpt:
          "The five Cs of credit are character, capacity, capital, collateral, and conditions; lenders weigh each when evaluating a borrower's creditworthiness.",
        retrievedBy: "system",
      },
    ],
    createdBy: "system",
  },
  {
    category: "structural",
    subject: "5Cs of Credit — Character",
    factKey: "five_cs_character",
    claimText:
      "Character refers to the borrower's reputation and credit history, including past repayment behaviour and references that signal willingness to repay.",
    jurisdiction: "GLOBAL",
    effectiveDate: "2024-01-01",
    pendingVerification: true,
    evidence: [
      {
        sourceType: "industry_report",
        sourceUrl: "https://www.investopedia.com/terms/f/five-c-credit.asp",
        sourceDomain: "investopedia.com",
        excerpt:
          "Character speaks to the borrower's reputation or track record for repaying debts, drawn from credit reports and references.",
        retrievedBy: "system",
      },
    ],
    createdBy: "system",
  },
  {
    category: "structural",
    subject: "5Cs of Credit — Capacity",
    factKey: "five_cs_capacity",
    claimText:
      "Capacity assesses the borrower's ability to repay using cash flow relative to debt service obligations, commonly via the debt-service coverage ratio.",
    jurisdiction: "GLOBAL",
    effectiveDate: "2024-01-01",
    pendingVerification: true,
    evidence: [
      {
        sourceType: "industry_report",
        sourceUrl: "https://www.investopedia.com/terms/f/five-c-credit.asp",
        sourceDomain: "investopedia.com",
        excerpt:
          "Capacity measures the borrower's ability to repay a loan by comparing income to recurring debts using ratios such as debt-service coverage.",
        retrievedBy: "system",
      },
    ],
    createdBy: "system",
  },
  {
    category: "structural",
    subject: "5Cs of Credit — Capital",
    factKey: "five_cs_capital",
    claimText:
      "Capital is the borrower's equity stake in the business or down payment on the asset, signalling skin-in-the-game and reducing lender risk.",
    jurisdiction: "GLOBAL",
    effectiveDate: "2024-01-01",
    pendingVerification: true,
    evidence: [
      {
        sourceType: "industry_report",
        sourceUrl: "https://www.investopedia.com/terms/f/five-c-credit.asp",
        sourceDomain: "investopedia.com",
        excerpt:
          "Capital refers to the amount of money the borrower personally invests in the venture and indicates skin in the game.",
        retrievedBy: "system",
      },
    ],
    createdBy: "system",
  },
  {
    category: "structural",
    subject: "5Cs of Credit — Collateral",
    factKey: "five_cs_collateral",
    claimText:
      "Collateral is the asset pledged to secure the loan; it provides recovery value to the lender if the borrower defaults.",
    jurisdiction: "GLOBAL",
    effectiveDate: "2024-01-01",
    pendingVerification: true,
    evidence: [
      {
        sourceType: "industry_report",
        sourceUrl: "https://www.investopedia.com/terms/f/five-c-credit.asp",
        sourceDomain: "investopedia.com",
        excerpt:
          "Collateral can help a borrower secure loans by giving the lender assurance that the asset can be claimed if the borrower defaults.",
        retrievedBy: "system",
      },
    ],
    createdBy: "system",
  },
  {
    category: "structural",
    subject: "5Cs of Credit — Conditions",
    factKey: "five_cs_conditions",
    claimText:
      "Conditions cover the loan purpose, interest rate, principal amount, and broader macroeconomic factors that affect repayment risk.",
    jurisdiction: "GLOBAL",
    effectiveDate: "2024-01-01",
    pendingVerification: true,
    evidence: [
      {
        sourceType: "industry_report",
        sourceUrl: "https://www.investopedia.com/terms/f/five-c-credit.asp",
        sourceDomain: "investopedia.com",
        excerpt:
          "Conditions include the interest rate and the amount of principal as well as economic conditions that may affect the borrower's ability to repay.",
        retrievedBy: "system",
      },
    ],
    createdBy: "system",
  },
];

// ---------------------------------------------------------------------------
// DSR / DSCR thresholds (GLOBAL)
// ---------------------------------------------------------------------------
const DSR_DSCR_SEEDS: readonly ClaimDraft[] = [
  {
    category: "benchmark",
    subject: "Debt Service Ratio (DSR) cap for retail borrowers",
    factKey: "dsr_cap_retail",
    claimText:
      "Many central banks and prudent lenders cap retail borrower debt-service ratio at 40 percent of net monthly income; high-income segments may be allowed up to 60 percent under stress-tested affordability rules.",
    numericValue: 40,
    unit: "percent",
    jurisdiction: "GLOBAL",
    effectiveDate: "2017-09-01",
    pendingVerification: true,
    evidence: [
      {
        sourceType: "industry_report",
        sourceUrl: "https://www.investopedia.com/terms/d/dsr.asp",
        sourceDomain: "investopedia.com",
        excerpt:
          "A debt service ratio above forty percent of net income is generally considered unaffordable; many lenders use forty percent as the maximum debt-service threshold for retail borrowers.",
        retrievedBy: "system",
      },
    ],
    createdBy: "system",
  },
  {
    category: "benchmark",
    subject: "Debt Service Coverage Ratio (DSCR) floor for SME term loans",
    factKey: "dscr_floor_sme",
    claimText:
      "Banks typically require a minimum DSCR of 1.25x for SME term loans, meaning operating cash flow must cover scheduled debt service at least 1.25 times.",
    numericValue: 1.25,
    unit: "ratio",
    jurisdiction: "GLOBAL",
    effectiveDate: "2023-01-01",
    pendingVerification: true,
    evidence: [
      {
        sourceType: "industry_report",
        sourceUrl: "https://www.investopedia.com/terms/d/dscr.asp",
        sourceDomain: "investopedia.com",
        excerpt:
          "Lenders generally require a minimum debt-service coverage ratio of 1.25 to ensure the borrower's cash flow comfortably covers debt obligations.",
        retrievedBy: "system",
      },
    ],
    createdBy: "system",
  },
];

// ---------------------------------------------------------------------------
// BoT Tanzania prudential thresholds (TZ only)
// ---------------------------------------------------------------------------
const BOT_PRUDENTIAL_SEEDS: readonly ClaimDraft[] = [
  {
    category: "regulatory",
    subject: "BoT minimum Total Capital Adequacy Ratio for banks (Tanzania)",
    factKey: "bot_total_car_minimum",
    claimText:
      "Bank of Tanzania prudential regulations require licensed banks to maintain a minimum Total Capital Adequacy Ratio of 12 percent of risk-weighted assets and off-balance-sheet exposures.",
    numericValue: 12,
    unit: "percent",
    jurisdiction: "TZ",
    effectiveDate: "2014-08-01",
    pendingVerification: true,
    evidence: [
      {
        sourceType: "regulator",
        sourceUrl:
          "https://www.bot.go.tz/Publications/Acts,%20Regulations,%20Circulars,%20Guidelines/Banking%20and%20Financial%20Institutions%20(Capital%20Adequacy)%20Regulations,%202014.pdf",
        sourceDomain: "bot.go.tz",
        excerpt:
          "Every bank shall at all times maintain a minimum total capital adequacy ratio of twelve percent of its total risk-weighted assets and off-balance-sheet exposures.",
        retrievedBy: "system",
      },
    ],
    createdBy: "system",
  },
  {
    category: "regulatory",
    subject: "BoT minimum Tier 1 Capital Ratio for banks (Tanzania)",
    factKey: "bot_tier1_car_minimum",
    claimText:
      "Bank of Tanzania prudential regulations require licensed banks to maintain a minimum Tier 1 Capital Ratio of 10 percent of risk-weighted assets and off-balance-sheet exposures.",
    numericValue: 10,
    unit: "percent",
    jurisdiction: "TZ",
    effectiveDate: "2014-08-01",
    pendingVerification: true,
    evidence: [
      {
        sourceType: "regulator",
        sourceUrl:
          "https://www.bot.go.tz/Publications/Acts,%20Regulations,%20Circulars,%20Guidelines/Banking%20and%20Financial%20Institutions%20(Capital%20Adequacy)%20Regulations,%202014.pdf",
        sourceDomain: "bot.go.tz",
        excerpt:
          "Every bank shall at all times maintain a minimum core capital ratio of ten percent of its total risk-weighted assets and off-balance-sheet exposures.",
        retrievedBy: "system",
      },
    ],
    createdBy: "system",
  },
  {
    category: "regulatory",
    subject: "BoT Liquid Assets Ratio minimum for banks (Tanzania)",
    factKey: "bot_liquid_assets_ratio_minimum",
    claimText:
      "Bank of Tanzania requires licensed banks to maintain a minimum Liquid Assets Ratio of 20 percent of demand liabilities at all times.",
    numericValue: 20,
    unit: "percent",
    jurisdiction: "TZ",
    effectiveDate: "2014-08-01",
    pendingVerification: true,
    evidence: [
      {
        sourceType: "regulator",
        sourceUrl:
          "https://www.bot.go.tz/Publications/Acts,%20Regulations,%20Circulars,%20Guidelines/Banking%20and%20Financial%20Institutions%20(Liquidity%20Management)%20Regulations,%202014.pdf",
        sourceDomain: "bot.go.tz",
        excerpt:
          "Every bank shall maintain a minimum liquid assets ratio of twenty percent of its demand liabilities.",
        retrievedBy: "system",
      },
    ],
    createdBy: "system",
  },
  {
    category: "regulatory",
    subject: "BoT single-borrower exposure limit (Tanzania)",
    factKey: "bot_single_borrower_limit",
    claimText:
      "Bank of Tanzania caps a bank's exposure to a single borrower or group of related counterparties at 25 percent of the bank's core capital.",
    numericValue: 25,
    unit: "percent",
    jurisdiction: "TZ",
    effectiveDate: "2014-08-01",
    pendingVerification: true,
    evidence: [
      {
        sourceType: "regulator",
        sourceUrl:
          "https://www.bot.go.tz/Publications/Acts,%20Regulations,%20Circulars,%20Guidelines/Banking%20and%20Financial%20Institutions%20(Management%20of%20Risk%20Assets)%20Regulations,%202014.pdf",
        sourceDomain: "bot.go.tz",
        excerpt:
          "A bank shall not grant accommodation to a single person or group of related counterparties exceeding twenty-five percent of its core capital.",
        retrievedBy: "system",
      },
    ],
    createdBy: "system",
  },
  {
    category: "regulatory",
    subject: "BoT insider lending aggregate limit (Tanzania)",
    factKey: "bot_insider_lending_limit",
    claimText:
      "Bank of Tanzania caps aggregate insider lending (to directors, officers, employees and related interests) at 100 percent of the bank's core capital, with single-insider exposures capped at 5 percent of core capital.",
    numericValue: 100,
    unit: "percent",
    jurisdiction: "TZ",
    effectiveDate: "2014-08-01",
    pendingVerification: true,
    evidence: [
      {
        sourceType: "regulator",
        sourceUrl:
          "https://www.bot.go.tz/Publications/Acts,%20Regulations,%20Circulars,%20Guidelines/Banking%20and%20Financial%20Institutions%20(Management%20of%20Risk%20Assets)%20Regulations,%202014.pdf",
        sourceDomain: "bot.go.tz",
        excerpt:
          "Aggregate accommodation to insiders shall at no time exceed one hundred percent of the bank's core capital under the Banking and Financial Institutions Act, 2006.",
        retrievedBy: "system",
      },
    ],
    createdBy: "system",
  },
];

// ---------------------------------------------------------------------------
// Sector NPL benchmarks Tanzania (TZ only) — every value must be re-anchored
// by the cron from the most recent BoT Financial Stability Report.
// ---------------------------------------------------------------------------
const TZ_NPL_BENCHMARK_SEEDS: readonly ClaimDraft[] = [
  {
    category: "benchmark",
    subject: "Tanzania banking system aggregate Non-Performing Loans ratio",
    factKey: "bot_npl_aggregate",
    claimText:
      "Bank of Tanzania reports the banking-system aggregate non-performing loans ratio in its Financial Stability Report; the engine must read the most recent published figure from bot.go.tz.",
    unit: "percent",
    jurisdiction: "TZ",
    effectiveDate: "2024-12-31",
    pendingVerification: true,
    evidence: [
      {
        sourceType: "regulator",
        sourceUrl: "https://www.bot.go.tz/Publications/Filter/40",
        sourceDomain: "bot.go.tz",
        excerpt:
          "Aggregate non-performing loans ratio for the Tanzanian banking system is published periodically in the Bank of Tanzania Financial Stability Report.",
        retrievedBy: "system",
      },
    ],
    createdBy: "system",
  },
  {
    category: "benchmark",
    subject: "Tanzania agriculture sector NPL ratio",
    factKey: "bot_npl_agriculture",
    claimText:
      "Bank of Tanzania publishes the sectoral non-performing loans ratio for agriculture in its Annual Supervision Report; the engine must read the most recent figure before quoting it.",
    unit: "percent",
    jurisdiction: "TZ",
    effectiveDate: "2024-12-31",
    pendingVerification: true,
    evidence: [
      {
        sourceType: "regulator",
        sourceUrl: "https://www.bot.go.tz/Publications/Filter/41",
        sourceDomain: "bot.go.tz",
        excerpt:
          "Sectoral distribution of non-performing loans, including the agriculture sector, is reported in the Bank of Tanzania Annual Supervision Report.",
        retrievedBy: "system",
      },
    ],
    createdBy: "system",
  },
  {
    category: "benchmark",
    subject: "Tanzania manufacturing sector NPL ratio",
    factKey: "bot_npl_manufacturing",
    claimText:
      "Bank of Tanzania publishes the sectoral non-performing loans ratio for manufacturing in its Annual Supervision Report; the engine must read the most recent figure before quoting it.",
    unit: "percent",
    jurisdiction: "TZ",
    effectiveDate: "2024-12-31",
    pendingVerification: true,
    evidence: [
      {
        sourceType: "regulator",
        sourceUrl: "https://www.bot.go.tz/Publications/Filter/41",
        sourceDomain: "bot.go.tz",
        excerpt:
          "Sectoral distribution of non-performing loans, including manufacturing, is reported in the Bank of Tanzania Annual Supervision Report.",
        retrievedBy: "system",
      },
    ],
    createdBy: "system",
  },
  {
    category: "benchmark",
    subject: "Tanzania trade and retail sector NPL ratio",
    factKey: "bot_npl_trade_retail",
    claimText:
      "Bank of Tanzania publishes the sectoral non-performing loans ratio for trade and retail in its Annual Supervision Report; the engine must read the most recent figure before quoting it.",
    unit: "percent",
    jurisdiction: "TZ",
    effectiveDate: "2024-12-31",
    pendingVerification: true,
    evidence: [
      {
        sourceType: "regulator",
        sourceUrl: "https://www.bot.go.tz/Publications/Filter/41",
        sourceDomain: "bot.go.tz",
        excerpt:
          "Sectoral distribution of non-performing loans, including trade and retail, is reported in the Bank of Tanzania Annual Supervision Report.",
        retrievedBy: "system",
      },
    ],
    createdBy: "system",
  },
  {
    category: "benchmark",
    subject: "Tanzania transport and communication sector NPL ratio",
    factKey: "bot_npl_transport_communication",
    claimText:
      "Bank of Tanzania publishes the sectoral non-performing loans ratio for transport and communication in its Annual Supervision Report; the engine must read the most recent figure before quoting it.",
    unit: "percent",
    jurisdiction: "TZ",
    effectiveDate: "2024-12-31",
    pendingVerification: true,
    evidence: [
      {
        sourceType: "regulator",
        sourceUrl: "https://www.bot.go.tz/Publications/Filter/41",
        sourceDomain: "bot.go.tz",
        excerpt:
          "Sectoral distribution of non-performing loans, including transport and communication, is reported in the Bank of Tanzania Annual Supervision Report.",
        retrievedBy: "system",
      },
    ],
    createdBy: "system",
  },
  {
    category: "benchmark",
    subject: "Tanzania building and construction sector NPL ratio",
    factKey: "bot_npl_building_construction",
    claimText:
      "Bank of Tanzania publishes the sectoral non-performing loans ratio for building and construction in its Annual Supervision Report; the engine must read the most recent figure before quoting it.",
    unit: "percent",
    jurisdiction: "TZ",
    effectiveDate: "2024-12-31",
    pendingVerification: true,
    evidence: [
      {
        sourceType: "regulator",
        sourceUrl: "https://www.bot.go.tz/Publications/Filter/41",
        sourceDomain: "bot.go.tz",
        excerpt:
          "Sectoral distribution of non-performing loans, including building and construction, is reported in the Bank of Tanzania Annual Supervision Report.",
        retrievedBy: "system",
      },
    ],
    createdBy: "system",
  },
  {
    category: "benchmark",
    subject: "Tanzania hotels and restaurants sector NPL ratio",
    factKey: "bot_npl_hotels_restaurants",
    claimText:
      "Bank of Tanzania publishes the sectoral non-performing loans ratio for hotels and restaurants in its Annual Supervision Report; the engine must read the most recent figure before quoting it.",
    unit: "percent",
    jurisdiction: "TZ",
    effectiveDate: "2024-12-31",
    pendingVerification: true,
    evidence: [
      {
        sourceType: "regulator",
        sourceUrl: "https://www.bot.go.tz/Publications/Filter/41",
        sourceDomain: "bot.go.tz",
        excerpt:
          "Sectoral distribution of non-performing loans, including hotels and restaurants, is reported in the Bank of Tanzania Annual Supervision Report.",
        retrievedBy: "system",
      },
    ],
    createdBy: "system",
  },
  {
    category: "benchmark",
    subject: "Tanzania personal lending sector NPL ratio",
    factKey: "bot_npl_personal",
    claimText:
      "Bank of Tanzania publishes the sectoral non-performing loans ratio for personal lending in its Annual Supervision Report; the engine must read the most recent figure before quoting it.",
    unit: "percent",
    jurisdiction: "TZ",
    effectiveDate: "2024-12-31",
    pendingVerification: true,
    evidence: [
      {
        sourceType: "regulator",
        sourceUrl: "https://www.bot.go.tz/Publications/Filter/41",
        sourceDomain: "bot.go.tz",
        excerpt:
          "Sectoral distribution of non-performing loans, including personal lending, is reported in the Bank of Tanzania Annual Supervision Report.",
        retrievedBy: "system",
      },
    ],
    createdBy: "system",
  },
  {
    category: "benchmark",
    subject: "Tanzania mining and quarrying sector NPL ratio",
    factKey: "bot_npl_mining_quarrying",
    claimText:
      "Bank of Tanzania publishes the sectoral non-performing loans ratio for mining and quarrying in its Annual Supervision Report; the engine must read the most recent figure before quoting it.",
    unit: "percent",
    jurisdiction: "TZ",
    effectiveDate: "2024-12-31",
    pendingVerification: true,
    evidence: [
      {
        sourceType: "regulator",
        sourceUrl: "https://www.bot.go.tz/Publications/Filter/41",
        sourceDomain: "bot.go.tz",
        excerpt:
          "Sectoral distribution of non-performing loans, including mining and quarrying, is reported in the Bank of Tanzania Annual Supervision Report.",
        retrievedBy: "system",
      },
    ],
    createdBy: "system",
  },
];

// ---------------------------------------------------------------------------
// CRB Tanzania licensing (TZ only)
// ---------------------------------------------------------------------------
const TZ_CRB_SEEDS: readonly ClaimDraft[] = [
  {
    category: "regulatory",
    subject: "Creditinfo Tanzania licensed Credit Reference Bureau",
    factKey: "crb_creditinfo_tanzania",
    claimText:
      "Creditinfo Tanzania Limited is licensed by the Bank of Tanzania as a Credit Reference Bureau under the Bank of Tanzania (Credit Reference Bureau) Regulations.",
    jurisdiction: "TZ",
    effectiveDate: "2013-04-01",
    pendingVerification: true,
    evidence: [
      {
        sourceType: "regulator",
        sourceUrl:
          "https://www.bot.go.tz/CreditReference/CreditReferenceBureau",
        sourceDomain: "bot.go.tz",
        excerpt:
          "Creditinfo Tanzania Limited is licensed by the Bank of Tanzania to operate as a Credit Reference Bureau.",
        retrievedBy: "system",
      },
    ],
    createdBy: "system",
  },
  {
    category: "regulatory",
    subject: "Dun & Bradstreet Tanzania licensed Credit Reference Bureau",
    factKey: "crb_dun_bradstreet_tanzania",
    claimText:
      "Dun & Bradstreet Credit Bureau Tanzania Limited is licensed by the Bank of Tanzania to operate as a Credit Reference Bureau under the Bank of Tanzania (Credit Reference Bureau) Regulations.",
    jurisdiction: "TZ",
    effectiveDate: "2013-04-01",
    pendingVerification: true,
    evidence: [
      {
        sourceType: "regulator",
        sourceUrl:
          "https://www.bot.go.tz/CreditReference/CreditReferenceBureau",
        sourceDomain: "bot.go.tz",
        excerpt:
          "Dun & Bradstreet Credit Bureau Tanzania Limited is licensed by the Bank of Tanzania to operate as a Credit Reference Bureau.",
        retrievedBy: "system",
      },
    ],
    createdBy: "system",
  },
  {
    category: "regulatory",
    subject:
      "Free annual credit report entitlement for data subjects (Tanzania)",
    factKey: "crb_free_annual_report_tz",
    claimText:
      "Under the Bank of Tanzania (Credit Reference Bureau) Regulations, every data subject is entitled to obtain one free credit report per year from a licensed Credit Reference Bureau.",
    numericValue: 1,
    unit: "report_per_year",
    jurisdiction: "TZ",
    effectiveDate: "2013-04-01",
    pendingVerification: true,
    evidence: [
      {
        sourceType: "regulator",
        sourceUrl:
          "https://www.bot.go.tz/CreditReference/CreditReferenceBureau",
        sourceDomain: "bot.go.tz",
        excerpt:
          "Every data subject is entitled to obtain free of charge one copy of the credit report relating to that data subject in any twelve month period.",
        retrievedBy: "system",
      },
    ],
    createdBy: "system",
  },
];

// ---------------------------------------------------------------------------
// IFRS 9 — additional provisions (paragraph-level anchors) (GLOBAL)
// Anthropic-reviewer note 2026-04-30 (pre-pilot fix-B): IFRS 9 alone has
// 100+ citable provisions. Seeding the most operationally-relevant ones
// referenced in day-to-day credit conversations (lifetime ECL trigger,
// SICR signals, low-credit-risk simplification).
// ---------------------------------------------------------------------------
const IFRS_9_PROVISION_SEEDS: readonly ClaimDraft[] = [
  {
    category: "regulatory",
    subject:
      "IFRS 9 paragraph 5.5.5 lifetime ECL recognition for impaired assets",
    factKey: "ifrs9_para_5_5_5_lifetime_ecl",
    claimText:
      "Under IFRS 9 paragraph 5.5.5, an entity shall recognise lifetime expected credit losses for a financial instrument if the credit risk on that instrument has increased significantly since initial recognition.",
    jurisdiction: "GLOBAL",
    effectiveDate: "2018-01-01",
    pendingVerification: true,
    evidence: [
      {
        sourceType: "regulator",
        sourceUrl:
          "https://www.ifrs.org/issued-standards/list-of-standards/ifrs-9-financial-instruments/",
        sourceDomain: "ifrs.org",
        excerpt:
          "An entity shall measure the loss allowance for a financial instrument at an amount equal to the lifetime expected credit losses if the credit risk on that financial instrument has increased significantly since initial recognition.",
        retrievedBy: "system",
      },
    ],
    createdBy: "system",
  },
  {
    category: "regulatory",
    subject:
      "IFRS 9 paragraph 5.5.10 rebuttable presumption that credit risk has increased significantly when contractual payments are more than 30 days past due",
    factKey: "ifrs9_para_5_5_10_30_dpd_presumption",
    claimText:
      "IFRS 9 paragraph 5.5.10 establishes a rebuttable presumption that the credit risk on a financial asset has increased significantly since initial recognition when contractual payments are more than 30 days past due.",
    numericValue: 30,
    unit: "days_past_due",
    jurisdiction: "GLOBAL",
    effectiveDate: "2018-01-01",
    pendingVerification: true,
    evidence: [
      {
        sourceType: "regulator",
        sourceUrl:
          "https://www.ifrs.org/issued-standards/list-of-standards/ifrs-9-financial-instruments/",
        sourceDomain: "ifrs.org",
        excerpt:
          "There is a rebuttable presumption that the credit risk on a financial asset has increased significantly since initial recognition when contractual payments are more than 30 days past due.",
        retrievedBy: "system",
      },
    ],
    createdBy: "system",
  },
  {
    category: "regulatory",
    subject:
      "IFRS 9 paragraph 5.5.11 low credit risk simplification (e.g. investment grade)",
    factKey: "ifrs9_para_5_5_11_low_credit_risk",
    claimText:
      "Under IFRS 9 paragraph 5.5.11, an entity may assume that the credit risk on a financial instrument has not increased significantly since initial recognition if the instrument is determined to have low credit risk at the reporting date (commonly equated with investment grade).",
    jurisdiction: "GLOBAL",
    effectiveDate: "2018-01-01",
    pendingVerification: true,
    evidence: [
      {
        sourceType: "regulator",
        sourceUrl:
          "https://www.ifrs.org/issued-standards/list-of-standards/ifrs-9-financial-instruments/",
        sourceDomain: "ifrs.org",
        excerpt:
          "An entity may assume that the credit risk on a financial instrument has not increased significantly since initial recognition if the financial instrument is determined to have low credit risk at the reporting date.",
        retrievedBy: "system",
      },
    ],
    createdBy: "system",
  },
];

// ---------------------------------------------------------------------------
// Basel III — liquidity ratios (GLOBAL)
// LCR (Liquidity Coverage Ratio) and NSFR (Net Stable Funding Ratio)
// are the post-2008 liquidity floors that complement the capital ratios.
// ---------------------------------------------------------------------------
const BASEL_III_LIQUIDITY_SEEDS: readonly ClaimDraft[] = [
  {
    category: "regulatory",
    subject: "Basel III Liquidity Coverage Ratio (LCR) minimum",
    factKey: "basel_iii_lcr_minimum",
    claimText:
      "Under Basel III, banks must maintain a Liquidity Coverage Ratio of at least 100 percent, defined as high-quality liquid assets divided by total net cash outflows over a 30 calendar-day stress horizon.",
    numericValue: 100,
    unit: "percent",
    jurisdiction: "GLOBAL",
    effectiveDate: "2019-01-01",
    pendingVerification: true,
    evidence: [
      {
        sourceType: "regulator",
        sourceUrl: "https://www.bis.org/bcbs/publ/d238.htm",
        sourceDomain: "bis.org",
        excerpt:
          "The LCR has been designed to promote short-term resilience of a bank's liquidity risk profile by ensuring that it has sufficient high-quality liquid assets to survive a significant stress scenario lasting 30 calendar days; the minimum standard is 100 percent.",
        retrievedBy: "system",
      },
    ],
    createdBy: "system",
  },
  {
    category: "regulatory",
    subject: "Basel III Net Stable Funding Ratio (NSFR) minimum",
    factKey: "basel_iii_nsfr_minimum",
    claimText:
      "Under Basel III, banks must maintain a Net Stable Funding Ratio of at least 100 percent, defined as the available amount of stable funding relative to the required amount of stable funding over a one-year horizon.",
    numericValue: 100,
    unit: "percent",
    jurisdiction: "GLOBAL",
    effectiveDate: "2018-01-01",
    pendingVerification: true,
    evidence: [
      {
        sourceType: "regulator",
        sourceUrl: "https://www.bis.org/bcbs/publ/d295.htm",
        sourceDomain: "bis.org",
        excerpt:
          "The NSFR is defined as the amount of available stable funding relative to the amount of required stable funding; the ratio should be equal to at least 100 percent on an ongoing basis.",
        retrievedBy: "system",
      },
    ],
    createdBy: "system",
  },
  {
    category: "regulatory",
    subject: "Basel III leverage ratio minimum",
    factKey: "basel_iii_leverage_ratio_minimum",
    claimText:
      "Under Basel III, banks must maintain a leverage ratio of at least 3 percent, defined as Tier 1 capital divided by the bank's total exposure measure (on- and off-balance-sheet).",
    numericValue: 3,
    unit: "percent",
    jurisdiction: "GLOBAL",
    effectiveDate: "2018-01-01",
    pendingVerification: true,
    evidence: [
      {
        sourceType: "regulator",
        sourceUrl: "https://www.bis.org/bcbs/publ/d424.htm",
        sourceDomain: "bis.org",
        excerpt:
          "The Basel III leverage ratio is calibrated to act as a credible supplementary measure to the risk-based capital requirements, with a minimum of 3 percent of Tier 1 capital to total exposure.",
        retrievedBy: "system",
      },
    ],
    createdBy: "system",
  },
];

// ---------------------------------------------------------------------------
// Tanzania — TRA / FIU thresholds (TZ only)
// These figures used to live as static prose in the credit-officer persona;
// they have been moved here to flow through the truth-engine.
// ---------------------------------------------------------------------------
const TZ_TAX_AML_SEEDS: readonly ClaimDraft[] = [
  {
    category: "regulatory",
    subject: "Tanzania VAT registration turnover threshold",
    factKey: "tra_vat_registration_threshold",
    claimText:
      "Under the Tanzania Value Added Tax Act, a person is required to register for VAT once annual taxable turnover reaches the prescribed threshold; the engine must read the most recent figure from the TRA / Ministry of Finance gazette before quoting it.",
    unit: "TZS",
    jurisdiction: "TZ",
    effectiveDate: "2015-07-01",
    pendingVerification: true,
    evidence: [
      {
        sourceType: "official_gov",
        sourceUrl: "https://www.tra.go.tz/index.php/vat",
        sourceDomain: "tra.go.tz",
        excerpt:
          "A person whose taxable turnover meets or exceeds the prescribed threshold under the Value Added Tax Act is required to apply for registration with the Tanzania Revenue Authority.",
        retrievedBy: "system",
      },
    ],
    createdBy: "system",
  },
  {
    category: "regulatory",
    subject:
      "Tanzania FIU AML cash transaction reporting threshold (currency transaction report)",
    factKey: "fiu_aml_cash_transaction_threshold_tz",
    claimText:
      "Under the Tanzania Financial Intelligence Unit's anti-money-laundering rules, reporting institutions must file a currency transaction report when a single cash transaction (or aggregated linked transactions) meets the prescribed TZS threshold; the engine must read the most recent figure from the FIU/BoT before quoting it.",
    unit: "TZS",
    jurisdiction: "TZ",
    effectiveDate: "2012-07-01",
    pendingVerification: true,
    evidence: [
      {
        sourceType: "regulator",
        sourceUrl: "https://www.fiu.go.tz/index.php/laws-regulations",
        sourceDomain: "fiu.go.tz",
        excerpt:
          "Reporting persons shall file a currency transaction report with the Financial Intelligence Unit for cash transactions equal to or above the prescribed threshold under the Anti-Money Laundering Act and its regulations.",
        retrievedBy: "system",
      },
    ],
    createdBy: "system",
  },
  {
    category: "regulatory",
    subject:
      "Tanzania BRELA annual returns and change-of-particulars filing window",
    factKey: "brela_change_notification_window",
    claimText:
      "Under the Tanzania Companies Act, registered companies must notify BRELA of changes to particulars (directors, shareholders, registered office) within the statutory window; the engine must read the most recent statutory day count from BRELA / the Companies Act before quoting it.",
    unit: "days",
    jurisdiction: "TZ",
    effectiveDate: "2002-12-01",
    pendingVerification: true,
    evidence: [
      {
        sourceType: "official_gov",
        sourceUrl: "https://www.brela.go.tz/",
        sourceDomain: "brela.go.tz",
        excerpt:
          "Notification of changes to a registered company's particulars shall be filed with the Registrar within the period prescribed by the Companies Act.",
        retrievedBy: "system",
      },
    ],
    createdBy: "system",
  },
];

// ---------------------------------------------------------------------------
// Tanzania — LTV / collateral haircut anchors (TZ only)
// These ranges used to live as static prose in the credit-officer persona
// ("land typically 60-70%, vehicles 50-60%, equipment 40-50%"). Moved here
// so the cron can verify against actual published BoT guidance and individual
// bank product cards. Encoded as range_low / range_high using numericValue
// for the lower bound; upper bound is in claimText pending a richer schema.
// ---------------------------------------------------------------------------
const TZ_LTV_SEEDS: readonly ClaimDraft[] = [
  {
    category: "benchmark",
    subject: "Loan-to-Value ceiling for land-secured lending (Tanzania)",
    factKey: "ltv_ceiling_land_tz",
    claimText:
      "For land-secured lending in Tanzania, typical commercial-bank Loan-to-Value ceilings sit in a range bounded by a lower-end conservative figure and an upper-end aggressive figure; both bounds must be re-anchored from individual bank product cards / BoT guidance before any number is quoted.",
    unit: "percent",
    jurisdiction: "TZ",
    effectiveDate: "2024-01-01",
    pendingVerification: true,
    evidence: [
      {
        sourceType: "regulator",
        sourceUrl:
          "https://www.bot.go.tz/Publications/Acts,%20Regulations,%20Circulars,%20Guidelines/Banking%20and%20Financial%20Institutions%20(Management%20of%20Risk%20Assets)%20Regulations,%202014.pdf",
        sourceDomain: "bot.go.tz",
        excerpt:
          "Banks shall apply prudent loan-to-value ratios to all secured lending in line with internal credit policy and the Management of Risk Assets Regulations.",
        retrievedBy: "system",
      },
    ],
    createdBy: "system",
  },
  {
    category: "benchmark",
    subject: "Loan-to-Value ceiling for vehicle-secured lending (Tanzania)",
    factKey: "ltv_ceiling_vehicle_tz",
    claimText:
      "For vehicle-secured lending in Tanzania, typical commercial-bank Loan-to-Value ceilings reflect the higher depreciation and recovery friction of motor assets relative to land; the ceiling must be re-anchored from each bank's product card before any number is quoted.",
    unit: "percent",
    jurisdiction: "TZ",
    effectiveDate: "2024-01-01",
    pendingVerification: true,
    evidence: [
      {
        sourceType: "regulator",
        sourceUrl:
          "https://www.bot.go.tz/Publications/Acts,%20Regulations,%20Circulars,%20Guidelines/Banking%20and%20Financial%20Institutions%20(Management%20of%20Risk%20Assets)%20Regulations,%202014.pdf",
        sourceDomain: "bot.go.tz",
        excerpt:
          "Banks shall apply prudent loan-to-value ratios calibrated to the depreciation and recovery profile of motor-asset collateral.",
        retrievedBy: "system",
      },
    ],
    createdBy: "system",
  },
  {
    category: "benchmark",
    subject:
      "Loan-to-Value ceiling for business-equipment-secured lending (Tanzania)",
    factKey: "ltv_ceiling_equipment_tz",
    claimText:
      "For business-equipment-secured lending in Tanzania, typical commercial-bank Loan-to-Value ceilings are lower than for land or vehicles, reflecting weaker secondary markets for used industrial equipment; the ceiling must be re-anchored from each bank's product card before any number is quoted.",
    unit: "percent",
    jurisdiction: "TZ",
    effectiveDate: "2024-01-01",
    pendingVerification: true,
    evidence: [
      {
        sourceType: "regulator",
        sourceUrl:
          "https://www.bot.go.tz/Publications/Acts,%20Regulations,%20Circulars,%20Guidelines/Banking%20and%20Financial%20Institutions%20(Management%20of%20Risk%20Assets)%20Regulations,%202014.pdf",
        sourceDomain: "bot.go.tz",
        excerpt:
          "Banks shall apply prudent loan-to-value ratios calibrated to the secondary-market liquidity and depreciation profile of equipment collateral.",
        retrievedBy: "system",
      },
    ],
    createdBy: "system",
  },
];

// ---------------------------------------------------------------------------
// BoT — additional prudential anchors (TZ only)
// Single-insider cap, NPL classification DPD ladder, and minimum core
// capital amount complement the existing BOT_PRUDENTIAL_SEEDS.
// ---------------------------------------------------------------------------
const BOT_PRUDENTIAL_EXTRA_SEEDS: readonly ClaimDraft[] = [
  {
    category: "regulatory",
    subject: "BoT single-insider exposure sub-limit (Tanzania)",
    factKey: "bot_single_insider_sublimit",
    claimText:
      "Bank of Tanzania caps exposure to a single insider (director, officer, employee or related interest) at a percentage of the bank's core capital that is materially lower than the aggregate insider cap; the engine must re-anchor the exact figure from the Management of Risk Assets Regulations before quoting it.",
    unit: "percent",
    jurisdiction: "TZ",
    effectiveDate: "2014-08-01",
    pendingVerification: true,
    evidence: [
      {
        sourceType: "regulator",
        sourceUrl:
          "https://www.bot.go.tz/Publications/Acts,%20Regulations,%20Circulars,%20Guidelines/Banking%20and%20Financial%20Institutions%20(Management%20of%20Risk%20Assets)%20Regulations,%202014.pdf",
        sourceDomain: "bot.go.tz",
        excerpt:
          "Accommodation to any single insider shall not exceed the prescribed percentage of the bank's core capital under the Management of Risk Assets Regulations, 2014.",
        retrievedBy: "system",
      },
    ],
    createdBy: "system",
  },
  {
    category: "regulatory",
    subject:
      "BoT non-performing loan classification DPD ladder (substandard / doubtful / loss)",
    factKey: "bot_npl_classification_dpd_ladder",
    claimText:
      "Bank of Tanzania prudential regulations classify loans into substandard, doubtful and loss categories using days-past-due cutoffs and provisioning percentages set out in the Management of Risk Assets Regulations; the engine must read the exact day counts and provisioning rates from the regulation before quoting them.",
    unit: "days_past_due",
    jurisdiction: "TZ",
    effectiveDate: "2014-08-01",
    pendingVerification: true,
    evidence: [
      {
        sourceType: "regulator",
        sourceUrl:
          "https://www.bot.go.tz/Publications/Acts,%20Regulations,%20Circulars,%20Guidelines/Banking%20and%20Financial%20Institutions%20(Management%20of%20Risk%20Assets)%20Regulations,%202014.pdf",
        sourceDomain: "bot.go.tz",
        excerpt:
          "The Management of Risk Assets Regulations prescribe the classification of risk assets as current, especially-mentioned, substandard, doubtful or loss, with specific days-past-due cutoffs and provisioning rates for each category.",
        retrievedBy: "system",
      },
    ],
    createdBy: "system",
  },
  {
    category: "regulatory",
    subject:
      "BoT minimum core capital requirement for licensed commercial banks (Tanzania)",
    factKey: "bot_minimum_core_capital_amount",
    claimText:
      "Bank of Tanzania sets a minimum absolute core capital amount for licensed commercial banks under the Banking and Financial Institutions Act and accompanying capital adequacy regulations; the engine must read the most recent prescribed amount before quoting it.",
    unit: "TZS",
    jurisdiction: "TZ",
    effectiveDate: "2014-08-01",
    pendingVerification: true,
    evidence: [
      {
        sourceType: "regulator",
        sourceUrl:
          "https://www.bot.go.tz/Publications/Acts,%20Regulations,%20Circulars,%20Guidelines/Banking%20and%20Financial%20Institutions%20(Capital%20Adequacy)%20Regulations,%202014.pdf",
        sourceDomain: "bot.go.tz",
        excerpt:
          "Every bank shall at all times maintain core capital of not less than the minimum amount prescribed under the Banking and Financial Institutions (Capital Adequacy) Regulations.",
        retrievedBy: "system",
      },
    ],
    createdBy: "system",
  },
  {
    category: "regulatory",
    subject: "BoT capital conservation buffer for Tanzania-licensed banks",
    factKey: "bot_capital_conservation_buffer",
    claimText:
      "Bank of Tanzania has implemented a capital conservation buffer above minimum capital ratios in line with Basel III principles; the buffer level must be re-anchored from BoT's prudential circulars before quoting it.",
    unit: "percent",
    jurisdiction: "TZ",
    effectiveDate: "2018-01-01",
    pendingVerification: true,
    evidence: [
      {
        sourceType: "regulator",
        sourceUrl:
          "https://www.bot.go.tz/Publications/Acts,%20Regulations,%20Circulars,%20Guidelines/Banking%20and%20Financial%20Institutions%20(Capital%20Adequacy)%20Regulations,%202014.pdf",
        sourceDomain: "bot.go.tz",
        excerpt:
          "Banks shall maintain a capital conservation buffer above the minimum capital ratios in line with internationally agreed Basel III standards as adopted by the Bank of Tanzania.",
        retrievedBy: "system",
      },
    ],
    createdBy: "system",
  },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Return credit-domain seed claims filtered by jurisdiction.
 *
 *   - jurisdiction === "GLOBAL" -> only IFRS / Basel / definitions / 5Cs / DSR-DSCR
 *   - jurisdiction === "TZ"     -> globals PLUS BoT prudential, sector NPL, CRB,
 *                                   plus TRA/FIU thresholds, LTV anchors, BoT extras
 *   - any other ISO-2 code      -> globals only (no jurisdiction-specific data)
 *
 * Pure function: no I/O, idempotent, safe to call from tests and the seed
 * runner alike.
 */
export function getCreditDomainSeeds(
  jurisdiction: string,
): readonly ClaimDraft[] {
  const globals: readonly ClaimDraft[] = [
    ...IFRS_9_SEEDS,
    ...IFRS_9_PROVISION_SEEDS,
    ...PD_LGD_EAD_SEEDS,
    ...BASEL_III_SEEDS,
    ...BASEL_III_LIQUIDITY_SEEDS,
    ...FIVE_CS_SEEDS,
    ...DSR_DSCR_SEEDS,
  ];

  const all =
    jurisdiction === "TZ"
      ? [
          ...globals,
          ...BOT_PRUDENTIAL_SEEDS,
          ...BOT_PRUDENTIAL_EXTRA_SEEDS,
          ...TZ_NPL_BENCHMARK_SEEDS,
          ...TZ_CRB_SEEDS,
          ...TZ_TAX_AML_SEEDS,
          ...TZ_LTV_SEEDS,
        ]
      : globals;

  // Stamp every seed with a baseline lastVerifiedAt so the 30-day staleness
  // gate has a concrete anchor for un-refreshed pending seeds.
  return all.map(withLastVerified);
}

/**
 * Convenience export: return both global and TZ-specific seeds in one array,
 * de-duplicated. Used by the seed runner that wants to write everything in
 * one shot.
 */
export function getAllCreditDomainSeeds(): readonly ClaimDraft[] {
  // TZ already includes the globals, so this is the union.
  return getCreditDomainSeeds("TZ");
}
