/**
 * Platform built-in concepts — TS-mirror of the 10 rows seeded by
 * migration 0210_tutoring_skill_pack.sql.
 *
 * Allows the tutor to boot without a database connection (tests,
 * dev mode, fallback when the DB is unreachable). The unit test
 * `__tests__/built-in-concepts.test.ts` asserts parity with the SQL
 * seed.
 */

import type { TutoringConcept } from './types.js';

function concept(
  id: string,
  conceptSlug: string,
  displayNameEn: string,
  displayNameSw: string | null,
  description: string,
  prerequisiteConcepts: readonly string[] | null,
  content: TutoringConcept['content'],
  dataBinding: TutoringConcept['dataBinding'] | null,
): TutoringConcept {
  return {
    id,
    tenantId: null,
    conceptSlug,
    displayNameEn,
    displayNameSw,
    description,
    prerequisiteConcepts: prerequisiteConcepts ?? [],
    masteryThresholds: {
      beginner: { min_correct: 1 },
      intermediate: { min_correct: 3, window: 7 },
      advanced: { min_correct: 6, window: 14 },
    },
    content,
    dataBinding,
  };
}

export const BUILT_IN_CONCEPTS: Readonly<Record<string, TutoringConcept>> = {
  net_operating_income: concept(
    'skill_net_operating_income',
    'net_operating_income',
    'Net Operating Income (NOI)',
    'Mapato Halisi ya Uendeshaji',
    'Property revenue minus operating expenses, before debt service and taxes.',
    null,
    {
      hook:
        'You want to know if a property is actually making money. Profit on paper is not the same as cash from operations.',
      definition:
        'Net Operating Income (NOI) is gross rental income minus operating expenses. It excludes debt service, depreciation, capital expenditures, and income taxes.',
      formula: 'NOI = Gross Operating Income - Operating Expenses',
      worked_example: {
        prompt:
          'For your portfolio in {{period_label}}, gross income was {{gross_income}} and operating expenses were {{op_ex}}. What is NOI?',
        answer:
          'NOI = {{gross_income}} - {{op_ex}} = {{noi_expected}}',
        explanation:
          'Subtract operating expenses from gross income. Do not subtract mortgage interest or principal — those are below the NOI line.',
        citation_keys: ['gross_income', 'op_ex'],
      },
      common_mistakes: [
        'Subtracting mortgage interest — interest belongs below NOI in the income statement.',
        'Including capital expenditures (e.g. roof replacement) as operating expenses.',
        'Forgetting vacancy and credit loss when computing gross operating income.',
      ],
      check_understanding: [
        {
          question: 'Should mortgage interest be subtracted to compute NOI?',
          expected_pattern: 'no|below',
          hint: 'Interest is debt service. It belongs below NOI.',
        },
        {
          question: 'Are roof replacements part of NOI operating expenses?',
          expected_pattern: 'no|capex',
          hint: 'Capital expenditures are capitalised and depreciated, not expensed.',
        },
      ],
    },
    {
      source: 'payments-ledger.tenant.month_summary',
      inputs: { period: 'previous_month' },
      placeholders: {
        gross_income: '$.gross',
        op_ex: '$.opex',
        period_label: '$.period_label',
        noi_expected: '$.noi',
      },
    },
  ),

  cap_rate: concept(
    'skill_cap_rate',
    'cap_rate',
    'Capitalisation Rate (Cap Rate)',
    'Kiwango cha Kurudisha Mtaji',
    'Annual NOI divided by property market value — the unlevered yield.',
    ['net_operating_income'],
    {
      hook:
        'How do you compare two very different properties without their prices and financing distorting the picture? Cap rate gives you a clean apples-to-apples yield.',
      definition:
        'Cap rate is annual NOI divided by property market value, expressed as a percent. Higher cap rate = higher yield but typically higher risk.',
      formula: 'Cap Rate = (Annual NOI / Market Value) x 100',
      worked_example: {
        prompt:
          'A property has annual NOI of {{noi}} and a market value of {{value}}. What is the cap rate?',
        answer: 'Cap Rate = {{noi}} / {{value}} = {{cap_rate}}%',
        explanation:
          'Divide annual NOI by market value, multiply by 100 to get a percent.',
        citation_keys: ['noi', 'value'],
      },
      common_mistakes: [
        'Using monthly NOI instead of annual — always annualise first.',
        'Using purchase price instead of current market value.',
        'Confusing cap rate with cash-on-cash return (which factors in financing).',
      ],
      check_understanding: [
        {
          question:
            'If a property has annual NOI of 1.2M and value of 10M, what is the cap rate?',
          expected_pattern: '12|0\\.12',
          hint: '1.2M / 10M = 0.12 = 12%.',
        },
      ],
    },
    {
      source: 'payments-ledger.property.summary',
      inputs: { period: 'trailing_12_months' },
      placeholders: {
        noi: '$.annual_noi',
        value: '$.market_value',
        cap_rate: '$.cap_rate_pct',
      },
    },
  ),

  arrears_aging: concept(
    'skill_arrears_aging',
    'arrears_aging',
    'Arrears Aging',
    'Uchambuzi wa Madeni',
    'Bucketing unpaid balances by how long they have been outstanding.',
    null,
    {
      hook:
        'Not all outstanding balances are equal. A 15-day delay is friction; a 95-day delay is a probable bad debt. Aging makes that obvious.',
      definition:
        'Arrears aging sorts unpaid balances into time buckets — 0-30 days, 31-60, 61-90, 90+. Buckets to the right are riskier and need different actions.',
      formula: null,
      worked_example: {
        prompt:
          'Your portfolio in {{period_label}} shows: 0-30 days {{b1}}, 31-60 {{b2}}, 61-90 {{b3}}, 90+ {{b4}}. What is the total arrears? Which bucket is most concerning?',
        answer:
          'Total = {{b1}} + {{b2}} + {{b3}} + {{b4}} = {{total}}. The 90+ bucket ({{b4}}) is most concerning because recovery probability drops sharply after 90 days.',
        explanation:
          'Aging lets you focus collection effort on high-risk buckets, write off / provision the 90+ bucket, and forecast bad-debt expense.',
        citation_keys: ['b1', 'b2', 'b3', 'b4'],
      },
      common_mistakes: [
        'Treating total arrears as one number — masks the risk gradient.',
        'Failing to age by lease cycle date instead of calendar date.',
        'Not aging deposit refunds (they hit aging the other way — payable, not receivable).',
      ],
      check_understanding: [
        {
          question: 'Which aging bucket is highest risk?',
          expected_pattern: '90|90\\+',
          hint: 'Recovery probability drops after 90 days outstanding.',
        },
      ],
    },
    {
      source: 'payments-ledger.arrears.buckets',
      inputs: { period: 'current' },
      placeholders: {
        b1: '$.buckets[0].amount',
        b2: '$.buckets[1].amount',
        b3: '$.buckets[2].amount',
        b4: '$.buckets[3].amount',
        total: '$.total',
        period_label: '$.period_label',
      },
    },
  ),

  occupancy_rate: concept(
    'skill_occupancy_rate',
    'occupancy_rate',
    'Occupancy Rate',
    'Kiwango cha Ujazo',
    'Share of rentable units currently occupied.',
    null,
    {
      hook:
        'How full is your portfolio? Occupancy is the single most-watched property KPI because every vacant day is a day of lost rent you can never recover.',
      definition:
        'Occupancy rate is occupied units divided by total rentable units, expressed as a percent. Physical occupancy counts units; economic occupancy weights by rent and accounts for arrears.',
      formula: 'Physical Occupancy = (Occupied Units / Total Rentable Units) x 100',
      worked_example: {
        prompt:
          'You have {{total_units}} rentable units and {{occupied_units}} are occupied. What is physical occupancy?',
        answer:
          'Occupancy = {{occupied_units}} / {{total_units}} = {{occupancy_pct}}%',
        explanation:
          'Higher is better, but a 100% rate often means rents are set too low. 92-95% is healthy for residential.',
        citation_keys: ['total_units', 'occupied_units'],
      },
      common_mistakes: [
        'Including non-rentable units (e.g. amenity space) in the denominator.',
        'Ignoring the difference between physical and economic occupancy.',
        'Reporting month-end snapshot only — average over the month is more truthful.',
      ],
      check_understanding: [
        {
          question: 'If you have 50 units and 47 are occupied, what is occupancy?',
          expected_pattern: '94|0\\.94',
          hint: '47 / 50 = 0.94 = 94%.',
        },
      ],
    },
    {
      source: 'occupancy.portfolio.snapshot',
      inputs: { period: 'current' },
      placeholders: {
        total_units: '$.total',
        occupied_units: '$.occupied',
        occupancy_pct: '$.rate_pct',
      },
    },
  ),

  depreciation: concept(
    'skill_depreciation',
    'depreciation',
    'Depreciation',
    'Kupungua kwa Thamani',
    'Allocating the cost of an asset across its useful life.',
    null,
    {
      hook:
        'You spent millions on a building today. You will earn rent on it for decades. Matching that cost to those earnings is what depreciation does.',
      definition:
        'Depreciation systematically allocates the cost of a tangible asset over its useful life. Straight-line is most common: cost minus salvage, divided by useful life in years.',
      formula: 'Annual Depreciation = (Cost - Salvage) / Useful Life (years)',
      worked_example: {
        prompt:
          'A building cost {{cost}} with {{salvage}} salvage value and {{life}} years useful life. What is the annual straight-line depreciation?',
        answer:
          'Depreciation = ({{cost}} - {{salvage}}) / {{life}} = {{annual_depreciation}}',
        explanation:
          'This expense reduces book value over time and lowers taxable income. The cash hit happened on day 1 — depreciation is a non-cash expense.',
        citation_keys: ['cost', 'salvage', 'life'],
      },
      common_mistakes: [
        'Depreciating land — land does not depreciate.',
        'Confusing depreciation with capital expenditure — capex is cash out now; depreciation is the accounting allocation.',
        'Using accounting useful life when tax authority requires a different schedule.',
      ],
      check_understanding: [
        {
          question: 'Is land depreciable?',
          expected_pattern: 'no',
          hint: 'Only the building / improvements depreciate. Land does not.',
        },
      ],
    },
    null,
  ),

  trial_balance: concept(
    'skill_trial_balance',
    'trial_balance',
    'Trial Balance',
    'Salio la Majaribio',
    'A snapshot listing of every account balance to confirm debits equal credits.',
    null,
    {
      hook:
        'Double-entry bookkeeping says every transaction touches at least two accounts and the debits always equal the credits. The trial balance is the proof.',
      definition:
        'A trial balance lists every general-ledger account with its closing balance. Total debits must equal total credits.',
      formula: 'Total Debits == Total Credits',
      worked_example: {
        prompt:
          'Your trial balance for {{period_label}} shows total debits {{debits}} and total credits {{credits}}. Does it balance?',
        answer:
          'Debits {{debits}} = Credits {{credits}} -> balanced. Any difference indicates a recording error to find before producing financial statements.',
        explanation:
          'If debits and credits do not equal, you have an error — most often a transposition or a one-sided entry — and must fix it before closing.',
        citation_keys: ['debits', 'credits'],
      },
      common_mistakes: [
        'Stopping after the trial balance balances — balancing does not catch errors that affect both sides equally.',
        'Posting compound entries to the wrong account.',
        'Forgetting to reverse temporary accounts at period-end.',
      ],
      check_understanding: [
        {
          question:
            'If debits and credits do not equal, what does that mean?',
          expected_pattern: 'error|mistake',
          hint: 'It means somewhere a posting is wrong.',
        },
      ],
    },
    {
      source: 'payments-ledger.trial-balance',
      inputs: { period: 'previous_month' },
      placeholders: {
        debits: '$.total_debits',
        credits: '$.total_credits',
        period_label: '$.period_label',
      },
    },
  ),

  profit_and_loss: concept(
    'skill_profit_and_loss',
    'profit_and_loss',
    'Profit & Loss Statement',
    'Taarifa ya Faida na Hasara',
    'A period statement showing revenue, expenses, and resulting profit.',
    ['trial_balance'],
    {
      hook:
        'Did you make money this quarter? The P&L tells you — but only if you actually understand each line.',
      definition:
        'The Profit & Loss (a.k.a. Income Statement) reports revenue and expenses across a period. Bottom line: net income = revenue - expenses.',
      formula: 'Net Income = Revenue - Expenses',
      worked_example: {
        prompt:
          'In {{period_label}} you earned {{revenue}} in rental income and spent {{expenses}} across operations, debt service, and tax. What is net income?',
        answer: 'Net Income = {{revenue}} - {{expenses}} = {{net_income}}',
        explanation:
          'P&L is an accrual view — revenue is recognised when earned, not when cash arrives. That is why P&L can show profit while cash is negative.',
        citation_keys: ['revenue', 'expenses'],
      },
      common_mistakes: [
        'Treating P&L net income as cash — they often differ materially.',
        'Mixing operating and non-operating items together.',
        'Forgetting one-time gains / losses that distort run-rate.',
      ],
      check_understanding: [
        {
          question: 'Is the P&L cash-based or accrual-based?',
          expected_pattern: 'accrual',
          hint: 'Revenue is recognised when earned. Cash basis is a different report.',
        },
      ],
    },
    {
      source: 'payments-ledger.profit-and-loss',
      inputs: { period: 'previous_quarter' },
      placeholders: {
        revenue: '$.revenue',
        expenses: '$.expenses',
        net_income: '$.net_income',
        period_label: '$.period_label',
      },
    },
  ),

  balance_sheet: concept(
    'skill_balance_sheet',
    'balance_sheet',
    'Balance Sheet',
    'Mizania',
    'A point-in-time snapshot of assets, liabilities, and equity.',
    ['trial_balance'],
    {
      hook:
        'Net worth at a moment in time — what you own, what you owe, what is yours. The balance sheet is the single best snapshot of solvency.',
      definition:
        'Balance sheet shows assets = liabilities + equity at a specific date. Assets are what the entity owns; liabilities are what it owes; equity is the residual.',
      formula: 'Assets = Liabilities + Equity',
      worked_example: {
        prompt:
          'Your balance sheet on {{as_of_date}} reports assets {{assets}}, liabilities {{liabilities}}. What is equity?',
        answer: 'Equity = {{assets}} - {{liabilities}} = {{equity}}',
        explanation:
          'Equity is the residual after paying off every liability. Negative equity = technically insolvent.',
        citation_keys: ['assets', 'liabilities'],
      },
      common_mistakes: [
        'Confusing equity with cash — equity is a claim, not a balance.',
        'Failing to distinguish current from long-term liabilities.',
        'Carrying assets at cost when fair value materially differs.',
      ],
      check_understanding: [
        {
          question:
            'If assets are 5M and liabilities are 3M, what is equity?',
          expected_pattern: '2(M| million)?|2,000,000',
          hint: 'Equity = Assets - Liabilities = 5M - 3M = 2M.',
        },
      ],
    },
    {
      source: 'payments-ledger.balance-sheet',
      inputs: { period: 'current' },
      placeholders: {
        assets: '$.total_assets',
        liabilities: '$.total_liabilities',
        equity: '$.total_equity',
        as_of_date: '$.as_of_date',
      },
    },
  ),

  cash_flow: concept(
    'skill_cash_flow',
    'cash_flow',
    'Cash Flow Statement',
    'Taarifa ya Mtiririko wa Pesa',
    'Period-over-period movement of cash across operating, investing, and financing activities.',
    ['profit_and_loss'],
    {
      hook:
        'Profit is opinion; cash is fact. The cash flow statement is the most truthful financial statement because there is no accrual to hide behind.',
      definition:
        'Cash flow statement reconciles opening to closing cash across three sections: operating (day-to-day), investing (capex / asset purchases), and financing (debt + equity).',
      formula: 'Closing Cash = Opening Cash + CFO + CFI + CFF',
      worked_example: {
        prompt:
          'Opening cash {{opening}}, operating cash flow {{cfo}}, investing {{cfi}}, financing {{cff}}. What is closing cash?',
        answer:
          'Closing = {{opening}} + {{cfo}} + {{cfi}} + {{cff}} = {{closing}}',
        explanation:
          'Always tie closing cash back to the balance sheet cash line. If they do not agree, the statement is wrong.',
        citation_keys: ['opening', 'cfo', 'cfi', 'cff'],
      },
      common_mistakes: [
        'Confusing operating cash flow with net income.',
        'Misclassifying interest paid (operating under IFRS, can be financing under US GAAP).',
        'Forgetting non-cash items like depreciation in the indirect method.',
      ],
      check_understanding: [
        {
          question: 'Which section captures property purchases?',
          expected_pattern: 'invest',
          hint: 'Investing activities — buying long-term assets.',
        },
      ],
    },
    {
      source: 'payments-ledger.cash-flow',
      inputs: { period: 'previous_quarter' },
      placeholders: {
        opening: '$.opening_cash',
        cfo: '$.cfo',
        cfi: '$.cfi',
        cff: '$.cff',
        closing: '$.closing_cash',
      },
    },
  ),

  irr: concept(
    'skill_irr',
    'irr',
    'Internal Rate of Return (IRR)',
    'Kiwango cha Ndani cha Marejesho',
    'The discount rate that makes the net present value of all cash flows equal zero.',
    ['cash_flow'],
    {
      hook:
        'You can grow capital at different rates in different deals. IRR collapses all those cash flows into one comparable yield, so you can rank options on an apples-to-apples basis.',
      definition:
        'IRR is the discount rate at which NPV = 0. It is the implied yield of an investment given its actual cash flows and their timing.',
      formula: 'NPV(IRR) = sum( CF_t / (1+IRR)^t ) = 0',
      worked_example: {
        prompt:
          'A deal: invest {{outflow}} today, receive {{inflow_y1}} in year 1, {{inflow_y2}} in year 2, {{inflow_y3}} + sale proceeds {{terminal}} in year 3. What is IRR (approximately)?',
        answer:
          'Solving NPV = 0 gives IRR around {{irr_pct}}%. Use the IRR function in any spreadsheet or numerical solver.',
        explanation:
          'IRR is iterative — no closed-form. Higher IRR = better deal IF the underlying cash flows are reliable. Long-dated terminal values can inflate IRR misleadingly.',
        citation_keys: [
          'outflow',
          'inflow_y1',
          'inflow_y2',
          'inflow_y3',
          'terminal',
        ],
      },
      common_mistakes: [
        'Comparing IRRs across deals with very different durations.',
        'Trusting IRR when reinvestment assumptions are unrealistic.',
        'Confusing IRR with cash-on-cash or total return.',
      ],
      check_understanding: [
        {
          question: 'Is IRR computed using a closed-form formula?',
          expected_pattern: 'no|iterat|numerical',
          hint: 'IRR is iterative — solve numerically, no closed form.',
        },
      ],
    },
    null,
  ),
};

/** Reference in-memory store for tests / dev. */
export class InMemoryConceptStore {
  private readonly platformBuiltIns: Readonly<Record<string, TutoringConcept>>;
  private readonly tenantConcepts = new Map<string, TutoringConcept>();

  constructor(
    platformBuiltIns: Readonly<
      Record<string, TutoringConcept>
    > = BUILT_IN_CONCEPTS,
  ) {
    this.platformBuiltIns = platformBuiltIns;
  }

  async findBySlug(input: {
    readonly tenantId: string;
    readonly conceptSlug: string;
  }): Promise<TutoringConcept | null> {
    const key = `${input.tenantId}:${input.conceptSlug}`;
    const tenant = this.tenantConcepts.get(key);
    if (tenant) return tenant;
    return this.platformBuiltIns[input.conceptSlug] ?? null;
  }

  registerTenantConcept(concept: TutoringConcept): void {
    if (concept.tenantId == null) {
      throw new Error('registerTenantConcept requires tenantId');
    }
    this.tenantConcepts.set(`${concept.tenantId}:${concept.conceptSlug}`, concept);
  }

  listPlatformSlugs(): readonly string[] {
    return Object.keys(this.platformBuiltIns);
  }
}
