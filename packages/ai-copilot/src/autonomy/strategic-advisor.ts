/**
 * Strategic decision support.
 *
 * Single-turn advisor for portfolio-level questions the head asks between
 * briefings. Mirrors the consultant sub-persona structure — diagnose,
 * present 3+ options with trade-offs, recommend with rationale, name the
 * risks, list concrete next steps.
 *
 * The advisor is deterministic over a registry of recognised question
 * patterns. Unknown questions get a generic 3-option report seeded with
 * the available context so the head still gets useful thinking rather
 * than a refusal.
 */

export interface DecisionOption {
  readonly title: string;
  readonly summary: string;
  readonly pros: readonly string[];
  readonly cons: readonly string[];
}

export interface DecisionReport {
  readonly question: string;
  readonly canonicalKey: string | null;
  readonly options: readonly DecisionOption[];
  readonly tradeoffs: string;
  readonly rationale: string;
  readonly recommendation: string;
  readonly risks: readonly string[];
  readonly nextSteps: readonly string[];
  readonly skillsInvoked: readonly string[];
  readonly createdAt: string;
}

export interface AdviseContext {
  readonly portfolioValueMinorUnits?: number;
  readonly occupancyPct?: number;
  readonly arrearsRatioPct?: number;
  readonly avgRentMinorUnits?: number;
  readonly propertyCount?: number;
}

export interface StrategicAdvisorDeps {
  readonly clock?: () => Date;
}

export class StrategicAdvisor {
  private readonly deps: StrategicAdvisorDeps;

  constructor(deps: StrategicAdvisorDeps = {}) {
    this.deps = deps;
  }

  async advise(
    _tenantId: string,
    question: string,
    context: AdviseContext = {},
  ): Promise<DecisionReport> {
    const now = (this.deps.clock?.() ?? new Date()).toISOString();
    const key = matchCanonical(question);
    const builder = key ? CANONICAL_QUESTIONS[key] : buildGenericReport;
    const base = builder(question, context);
    return { ...base, canonicalKey: key, createdAt: now };
  }
}

export const CANONICAL_QUESTION_KEYS = [
  'refurbish_or_sell_block',
  'raise_rents_portfolio',
  'hire_or_automate',
  'consolidate_small_properties',
  'renegotiate_top_tenants',
] as const;

export type CanonicalQuestionKey = (typeof CANONICAL_QUESTION_KEYS)[number];

function matchCanonical(question: string): CanonicalQuestionKey | null {
  const q = question.toLowerCase();
  if (q.includes('refurbish') && q.includes('sell')) return 'refurbish_or_sell_block';
  if (q.includes('raise') && q.includes('rent')) return 'raise_rents_portfolio';
  if ((q.includes('hire') || q.includes('station master')) && q.includes('automat'))
    return 'hire_or_automate';
  if (q.includes('consolidate') && (q.includes('smallest') || q.includes('small')))
    return 'consolidate_small_properties';
  if (q.includes('renegotiate') && q.includes('tenant')) return 'renegotiate_top_tenants';
  return null;
}

type ReportBuilder = (
  question: string,
  context: AdviseContext,
) => Omit<DecisionReport, 'canonicalKey' | 'createdAt'>;

const CANONICAL_QUESTIONS: Record<CanonicalQuestionKey, ReportBuilder> = {
  refurbish_or_sell_block: (question) => ({
    question,
    options: [
      {
        title: 'Refurbish and hold',
        summary: 'Spend capex, improve rents, keep asset in portfolio.',
        pros: ['Protects yield', 'Signals commitment to quality'],
        cons: ['Ties up cash', 'Execution risk on contractors'],
      },
      {
        title: 'Sell and redeploy capital',
        summary: 'Exit at current valuation, recycle equity to stronger assets.',
        pros: ['Frees capital', 'Clean break with problem block'],
        cons: ['Transaction cost drag', 'Signals portfolio weakness'],
      },
      {
        title: 'Partial refurbishment + refinance',
        summary: 'Selective capex on high-ROI touches, pull equity via refi.',
        pros: ['Mid-risk', 'Retains option to sell later'],
        cons: ['Complex to execute', 'Refi depends on rate environment'],
      },
    ],
    tradeoffs: 'Refurbish maximises long-term NPV; sell maximises liquidity; partial balances both.',
    rationale:
      'Refurb wins when NPV of future rent uplift exceeds sale-proceeds return in best-alternate-asset. Sell wins when block has structural headwinds (location, zoning, tenant mix) that capex cannot fix. Ask the DCF skill for numbers before deciding.',
    recommendation:
      'Run the DCF valuation skill and the repair-vs-replace NPV skill on the block first. Decide once numbers are on the table — partial refurb is the default if both options return within 2pp of each other.',
    risks: [
      'Hidden structural cost revealed after tender',
      'Market softens between now and sale close',
      'Refi rate environment moves against you',
    ],
    nextSteps: [
      'Commission DCF valuation skill on the block',
      'Commission repair-vs-replace NPV skill',
      'Get two independent sale comparables',
      'Tender the partial-refurb scope to two contractors',
    ],
    skillsInvoked: ['dcf_valuation', 'repair_vs_replace_npv'],
  }),
  raise_rents_portfolio: (question, ctx) => ({
    question,
    options: [
      {
        title: 'Hold rents flat',
        summary: 'Preserve occupancy, lose to inflation.',
        pros: ['Zero churn risk', 'Simple message'],
        cons: ['Real-terms revenue erosion'],
      },
      {
        title: 'Raise 5% across the board',
        summary: 'Keep pace with inflation, absorb modest churn.',
        pros: ['Predictable uplift', 'Bands within normal expectations'],
        cons: ['Blanket raise punishes good tenants', 'Churn spike in soft segments'],
      },
      {
        title: 'Raise 10% with segmentation',
        summary: 'Above-inflation in strong segments, flat in weak.',
        pros: ['Captures value where demand is real', 'Protects vulnerable segments'],
        cons: ['Complex to execute', 'Requires per-segment evidence'],
      },
    ],
    tradeoffs: 'Blanket raises are fast but blunt; segmented raises need the repricing skill.',
    rationale:
      `Market evidence matters more than a flat percentage. Current arrears ratio (${ctx.arrearsRatioPct ?? 'unknown'}%) and occupancy (${ctx.occupancyPct ?? 'unknown'}%) signal absorptive capacity. Run the rent-repricing advisor skill per unit cluster before committing.`,
    recommendation:
      'Raise 5% baseline with segmented top-up to 10% where repricing skill shows headroom > 15%. Freeze raises on units in soft segments.',
    risks: [
      'Churn cascade in price-sensitive clusters',
      'Regulatory ceiling triggered',
      'Negative PR from blanket-sounding communications',
    ],
    nextSteps: [
      'Run rent-repricing-advisor across all unit clusters',
      'Draft communications with Consultant persona',
      'Stage raises over 60 days to absorb churn',
    ],
    skillsInvoked: ['rent_repricing_advisor', 'occupancy_forecast'],
  }),
  hire_or_automate: (question) => ({
    question,
    options: [
      {
        title: 'Hire 2-3 station masters',
        summary: 'Hands-on coverage, labour cost, slow to scale.',
        pros: ['Human touch for escalations', 'Local knowledge'],
        cons: ['Fixed cost', 'Training overhead'],
      },
      {
        title: 'Double down on automation',
        summary: 'More Mr. Mwikila, fewer humans; scales with portfolio.',
        pros: ['Near-zero marginal cost', '24/7 coverage'],
        cons: ['Requires data discipline', 'Edge cases still need humans'],
      },
      {
        title: 'Hybrid: 1 hire + automation',
        summary: 'One senior human, rest automated.',
        pros: ['Lower risk', 'Retains human judgement at top'],
        cons: ['Senior cost', 'Only works with good autonomy policy'],
      },
    ],
    tradeoffs: 'Automation scales; humans judge. The right split depends on portfolio size.',
    rationale:
      'Below ~200 units a single strong hire covers the gap. Above that, automation dominates on cost-per-unit. The autonomy-mode delegation matrix is the hinge — if policy is tight, automation is safe; if loose, hire first.',
    recommendation:
      'Run vacancy projection + occupancy forecast to size demand; if portfolio > 200 units go hybrid with one senior hire and aggressive autonomy policy.',
    risks: [
      'Automation failure mode erodes tenant trust',
      'Hire churns within 12 months',
      'Policy too loose without human oversight',
    ],
    nextSteps: [
      'Run occupancy-forecast + vacancy-projection skills',
      'Audit current delegation matrix coverage',
      'Draft JD for senior hire as backup option',
    ],
    skillsInvoked: ['occupancy_forecast', 'vacancy_projection'],
  }),
  consolidate_small_properties: (question) => ({
    question,
    options: [
      {
        title: 'Consolidate all three',
        summary: 'Sell and fold proceeds into larger holdings.',
        pros: ['Simpler management', 'Lower overhead per unit'],
        cons: ['Capital-gains friction', 'Loss of geographic diversification'],
      },
      {
        title: 'Consolidate the weakest one',
        summary: 'Keep the two strongest, exit the laggard.',
        pros: ['Balanced risk', 'Lower transaction cost'],
        cons: ['Partial benefit of consolidation'],
      },
      {
        title: 'Hold and professionalise management',
        summary: 'Keep all three, lean harder on Mr. Mwikila for coverage.',
        pros: ['Preserves diversification', 'No transaction cost'],
        cons: ['Overhead per unit stays elevated'],
      },
    ],
    tradeoffs: 'Consolidation trades diversification for simplicity; hold preserves optionality.',
    rationale:
      'Small properties carry disproportionate fixed overhead. DCF valuation per asset + board-report composer over the last 4 quarters exposes which of the three earns its cost-per-unit.',
    recommendation:
      'Consolidate the weakest property first; re-evaluate the other two at the next monthly briefing.',
    risks: [
      'Sale prices disappoint',
      'Redeployment takes longer than expected',
      'Tenant goodwill erodes during transition',
    ],
    nextSteps: [
      'Run DCF valuation per property',
      'Run board-report-composer for 4-quarter look-back',
      'Commission two independent comparables on the weakest asset',
    ],
    skillsInvoked: ['dcf_valuation', 'board_report_composer'],
  }),
  renegotiate_top_tenants: (question) => ({
    question,
    options: [
      {
        title: 'Offer 2-year lease at current rent',
        summary: 'Lock in tenure, no discount.',
        pros: ['Zero revenue give-up', 'Stability'],
        cons: ['Low incentive for tenant to sign'],
      },
      {
        title: '3-year lease at 5% discount',
        summary: 'Modest discount for meaningful tenure.',
        pros: ['Forecast stability', 'Retains strategic tenants'],
        cons: ['Give up potential repricing window'],
      },
      {
        title: '5-year lease at 10% discount + escalator',
        summary: 'Deep tenure, contractual escalator protects real terms.',
        pros: ['Highest stability', 'Escalator keeps rent aligned'],
        cons: ['Long tail of discount', 'Flexibility loss'],
      },
    ],
    tradeoffs: 'Longer tenure + deeper discount trades cash flow for predictability.',
    rationale:
      'Top 5 tenants by revenue typically drive 30-40% of NOI. Their churn risk sets the shape of the portfolio. The discount must be smaller than expected vacancy + releasing cost across the same window.',
    recommendation:
      '3-year lease at 5% discount + annual escalator. Run the vacancy-projection skill against each top tenant to size their churn risk first.',
    risks: [
      'Tenant cherry-picks the terms then leaves anyway',
      'Market moves against you during the lock',
      'Other tenants expect the same deal',
    ],
    nextSteps: [
      'Run vacancy-projection per top tenant',
      'Draft bespoke proposal with Consultant persona',
      'Review renewal calendar to sequence the conversations',
    ],
    skillsInvoked: ['vacancy_projection', 'rent_repricing_advisor'],
  }),
};

function buildGenericReport(
  question: string,
  _context: AdviseContext,
): Omit<DecisionReport, 'canonicalKey' | 'createdAt'> {
  return {
    question,
    options: [
      {
        title: 'Do nothing',
        summary: 'Hold position, gather more data.',
        pros: ['Low risk'],
        cons: ['Opportunity cost'],
      },
      {
        title: 'Act decisively',
        summary: 'Commit resources to one direction.',
        pros: ['Clear signal'],
        cons: ['Irreversible in the short run'],
      },
      {
        title: 'Pilot and learn',
        summary: 'Run a limited experiment, decide after data lands.',
        pros: ['De-risks the irreversible move'],
        cons: ['Delays full effect'],
      },
    ],
    tradeoffs: 'Hold preserves optionality; act captures upside; pilot balances both.',
    rationale:
      'Without a canonical pattern match, default to the pilot path. Commission a skill run before committing capital.',
    recommendation: 'Pilot and learn — scope a 6-week trial and re-evaluate.',
    risks: ['Pilot is too small to generate signal', 'Delay cost'],
    nextSteps: [
      'Define the pilot scope',
      'Identify the measurement hurdle',
      'Schedule the decision checkpoint in the next briefing',
    ],
    skillsInvoked: ['board_report_composer'],
  };
}
