/**
 * Generative UI Engine Types (BORJIE estate-management edition)
 *
 * Ported from LitFin's generative UI. These types describe structured
 * JSON blocks the AI can return. The AdaptiveRenderer maps each type
 * to an interactive React component.
 */

export type AIMode =
  | 'guide'        // operational guidance (tenancy workflow, maintenance steps)
  | 'learn'        // training / pedagogy (concept teaching, quizzes)
  | 'extract'      // document intelligence (lease parsing, ID extraction)
  | 'risk'         // tenancy risk (5 Ps analysis, arrears projection)
  | 'draft'        // document generation (notice templates, lease drafts)
  | 'advise'       // advisory voice for owners (portfolio decisions)
  | 'explore';     // public / marketing surface

export type UIBlockType =
  | 'rent_affordability_calculator'
  | 'arrears_projection_chart'
  | 'property_comparison_table'
  | 'lease_timeline_diagram'
  | 'maintenance_case_flow_diagram'
  | 'five_ps_tenancy_risk_wheel'
  | 'concept_card'
  | 'quiz'
  | 'action_buttons'
  | 'quick_replies'
  | 'insight_card'
  | 'dynamic_visual';

export interface UIBlockBase {
  readonly id: string;
  readonly type: UIBlockType;
  readonly position: 'inline' | 'below' | 'overlay';
  readonly animate?: boolean;
}

/** Rent affordability calculator (rent / gross_income) */
export interface RentAffordabilityCalculatorBlock extends UIBlockBase {
  readonly type: 'rent_affordability_calculator';
  readonly defaultRent: number;
  readonly defaultIncome: number;
  readonly currency: string;
  readonly title?: string;
  readonly titleSw?: string;
}

/** Arrears projection chart (cumulative unpaid rent over N months) */
export interface ArrearsProjectionChartBlock extends UIBlockBase {
  readonly type: 'arrears_projection_chart';
  readonly title: string;
  readonly titleSw?: string;
  readonly monthlyRent: number;
  readonly currency: string;
  readonly monthsDelinquent: number;
  readonly lateFeePerMonth: number;
  readonly points: readonly { readonly month: number; readonly cumulative: number }[];
}

/** Property comparison table for owner-advisor & tenant-assistant */
export interface PropertyComparisonTableBlock extends UIBlockBase {
  readonly type: 'property_comparison_table';
  readonly title: string;
  readonly titleSw?: string;
  readonly columns: readonly { readonly header: string; readonly highlight?: boolean }[];
  readonly rows: readonly { readonly label: string; readonly values: readonly string[] }[];
}

/** Lease timeline diagram (signing -> rent start -> renewal -> end) */
export interface LeaseTimelineDiagramBlock extends UIBlockBase {
  readonly type: 'lease_timeline_diagram';
  readonly title: string;
  readonly titleSw?: string;
  readonly events: readonly {
    readonly label: string;
    readonly date: string;
    readonly status: 'completed' | 'current' | 'upcoming';
    readonly description?: string;
  }[];
}

/** Maintenance case flow diagram (reported -> triaged -> assigned -> resolved) */
export interface MaintenanceCaseFlowDiagramBlock extends UIBlockBase {
  readonly type: 'maintenance_case_flow_diagram';
  readonly title: string;
  readonly titleSw?: string;
  readonly currentStage: 'reported' | 'triaged' | 'assigned' | 'in_progress' | 'resolved' | 'closed';
  readonly stages: readonly {
    readonly id: 'reported' | 'triaged' | 'assigned' | 'in_progress' | 'resolved' | 'closed';
    readonly label: string;
    readonly timestamp?: string;
    readonly actor?: string;
  }[];
}

/** 5 Ps tenancy-risk wheel */
export interface FivePsRiskWheelBlock extends UIBlockBase {
  readonly type: 'five_ps_tenancy_risk_wheel';
  readonly title: string;
  readonly titleSw?: string;
  readonly scores: {
    readonly paymentHistory: number;
    readonly propertyFit: number;
    readonly purpose: number;
    readonly person: number;
    readonly protection: number;
  };
  readonly overallRating: 'A' | 'B' | 'C' | 'D' | 'F';
}

/** Generic concept card */
export interface ConceptCardBlock extends UIBlockBase {
  readonly type: 'concept_card';
  readonly title: string;
  readonly titleSw?: string;
  readonly description: string;
  readonly descriptionSw?: string;
  readonly keyPoints: readonly string[];
  readonly bloomLevel?: 'remember' | 'understand' | 'apply' | 'analyze' | 'evaluate' | 'create';
}

/** Quiz block */
export interface QuizBlock extends UIBlockBase {
  readonly type: 'quiz';
  readonly question: string;
  readonly questionSw?: string;
  readonly options: readonly {
    readonly id: string;
    readonly label: string;
    readonly isCorrect: boolean;
    readonly explanation?: string;
  }[];
  readonly difficulty: 'beginner' | 'intermediate' | 'advanced';
}

/** Action buttons (next step options) */
export interface ActionButtonsBlock extends UIBlockBase {
  readonly type: 'action_buttons';
  readonly layout: 'horizontal' | 'vertical' | 'grid';
  readonly buttons: readonly {
    readonly id: string;
    readonly label: string;
    readonly variant: 'primary' | 'secondary' | 'outline' | 'success' | 'warning';
    readonly action: string;
  }[];
}

/** Quick reply chips */
export interface QuickRepliesBlock extends UIBlockBase {
  readonly type: 'quick_replies';
  readonly replies: readonly {
    readonly label: string;
    readonly prompt: string;
  }[];
}

/** Insight card */
export interface InsightCardBlock extends UIBlockBase {
  readonly type: 'insight_card';
  readonly insightType: 'tip' | 'warning' | 'success' | 'info';
  readonly title: string;
  readonly message: string;
  readonly actionLabel?: string;
  readonly actionPrompt?: string;
}

/** Freeform SVG block (the AI's blackboard chalk) */
export interface DynamicVisualBlock extends UIBlockBase {
  readonly type: 'dynamic_visual';
  readonly svg: string;
  readonly title?: string;
  readonly alt?: string;
  readonly caption?: string;
}

export type UIBlock =
  | RentAffordabilityCalculatorBlock
  | ArrearsProjectionChartBlock
  | PropertyComparisonTableBlock
  | LeaseTimelineDiagramBlock
  | MaintenanceCaseFlowDiagramBlock
  | FivePsRiskWheelBlock
  | ConceptCardBlock
  | QuizBlock
  | ActionButtonsBlock
  | QuickRepliesBlock
  | InsightCardBlock
  | DynamicVisualBlock;

export interface AdaptiveMessageMetadata {
  readonly mode?: AIMode;
  readonly uiBlocks?: readonly UIBlock[];
  readonly suggestedMode?: AIMode;
  readonly complexityLevel?: 'simplified' | 'standard' | 'advanced';
}

/**
 * Generate a unique block ID.
 *
 * Bug fix A-BUG-DEEP #11: prefer `crypto.randomUUID()` over
 * `Math.random()` for ID generation. Math.random produces predictable
 * sequences that observers can correlate; the WebCrypto / Node crypto
 * RNG is unguessable.
 */
export function generateBlockId(): string {
  const cryptoApi =
    (typeof globalThis !== 'undefined' &&
      (globalThis as { crypto?: { randomUUID?: () => string } }).crypto) ||
    undefined;
  if (cryptoApi?.randomUUID) {
    return `block-${cryptoApi.randomUUID()}`;
  }
  // eslint-disable-next-line no-restricted-syntax -- SCRUB-5f: rule-disabled because Math.random is an acceptable last-ditch fallback for transient UI block ids when crypto.randomUUID is unavailable
  return `block-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}
