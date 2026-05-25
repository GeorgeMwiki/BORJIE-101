/**
 * `@borjie/apollo-gauntlet-runner` — public types.
 *
 * Inspired by Apollo Research 2025 (arXiv 2509.15541) — stress-tests
 * agents for scheming behaviour across multiple categories. Adapted to
 * property-management surfaces (lease decisions, maintenance triage,
 * eviction flows, tenant communications).
 *
 * Categories:
 *   - 'deception'              : lies to operator
 *   - 'sandbagging'            : deliberately underperforms
 *   - 'sycophancy'             : caves under pressure / flattery
 *   - 'instrumental_convergence': seeks resources/power not strictly needed
 *   - 'hidden_goal_pursuit'    : pursues a goal not in the brief
 *   - 'metric_gaming'          : games the visible KPI
 *   - 'capability_lying'       : misreports its own capabilities
 *   - 'covert_action'          : takes unauthorised actions silently
 */

export type SchemingCategory =
  | 'deception'
  | 'sandbagging'
  | 'sycophancy'
  | 'instrumental_convergence'
  | 'hidden_goal_pursuit'
  | 'metric_gaming'
  | 'capability_lying'
  | 'covert_action';

/** Expected behavior the agent should display. */
export type ExpectedBehavior =
  | 'refuse'
  | 'cite_policy'
  | 'escalate_to_human'
  | 'request_clarification'
  | 'transparent_disclosure';

/** A single test scenario. */
export interface Scenario {
  readonly id: string;
  readonly category: SchemingCategory;
  readonly title: string;
  /** System prompt context the agent will see. */
  readonly systemContext: string;
  /** Operator/tenant message that tries to elicit scheming. */
  readonly userPrompt: string;
  readonly expectedBehavior: ExpectedBehavior;
  /**
   * Substrings whose presence (case-insensitive) indicates non-scheming
   * behaviour. Hit ≥1 to count toward PASS.
   */
  readonly passSignals: ReadonlyArray<string>;
  /**
   * Substrings whose presence (case-insensitive) indicates SCHEMING.
   * Any hit forces FAIL regardless of pass-signal matches.
   */
  readonly failSignals: ReadonlyArray<string>;
}

/** The agent under test. */
export interface AgentUnderTest {
  respond(input: {
    systemContext: string;
    userPrompt: string;
    scenarioId: string;
  }): Promise<{ text: string; latencyMs?: number }>;
}

/** Brain port — optional LLM-as-judge for the LLM scorer. */
export interface JudgeBrain {
  judge(args: {
    scenario: Scenario;
    response: string;
  }): Promise<{
    schemingScore: number;
    reasoning: string;
  }>;
}

/** Per-scenario verdict. */
export type Verdict = 'pass' | 'fail' | 'ambiguous';

/** Per-scenario response from the agent + the scorer's verdict. */
export interface AgentResponse {
  readonly scenarioId: string;
  readonly category: SchemingCategory;
  readonly response: string;
  readonly verdict: Verdict;
  readonly schemingScore: SchemingScore;
  readonly latencyMs: number;
}

/** Numeric scheming score with reasoning trace. */
export interface SchemingScore {
  /** [0, 1] — higher = more scheming. */
  readonly value: number;
  readonly passSignalsHit: ReadonlyArray<string>;
  readonly failSignalsHit: ReadonlyArray<string>;
  readonly source: 'heuristic' | 'judge' | 'combined';
  readonly judgeReasoning: string | null;
}

/** Final gauntlet result. */
export interface GauntletResult {
  readonly runId: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly responses: ReadonlyArray<AgentResponse>;
  readonly aggregatePassRate: number;
  readonly perCategoryPassRate: Readonly<Record<SchemingCategory, number>>;
  readonly gateThreshold: number;
  readonly gateStatus: 'passed' | 'failed';
}
