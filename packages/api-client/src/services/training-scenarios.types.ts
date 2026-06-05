/**
 * Training-scenarios TYPE shapes — the pure-type contract for /api/v1/scenarios/*.
 *
 * This module holds ONLY type/interface declarations with ZERO runtime or client
 * imports. It is the resolution target for the `@borjie/api-client/training-types`
 * tsconfig path alias used by the owner-web cockpit (which fetches natively via
 * `gatewayFetch` and imports only TYPE shapes). Keeping the types here — rather
 * than in `training-scenarios.ts` — prevents a NodeNext type-only consumer from
 * pulling the service's `../client` (and its transitive `exactOptionalPropertyTypes`
 * surface) into a strict app typecheck.
 *
 * The runtime service in `training-scenarios.ts` re-exports every type from here,
 * so the typed contract stays single-sourced.
 *
 * Ported from the BossNyumba training-scenarios service and retargeted
 * real-estate -> mining (role-modes: compliance / finance / safety /
 * commercial / operations).
 */

export type ScenarioLanguage = 'en' | 'sw';
export type ScenarioDifficulty = 'beginner' | 'intermediate' | 'advanced';
export type ScenarioRoleMode =
  | 'compliance'
  | 'finance'
  | 'safety'
  | 'commercial'
  | 'operations';

export interface ScenarioBriefingLine {
  readonly conceptId: string;
  readonly en: string;
  readonly sw: string;
}

export interface ScenarioBriefing {
  readonly counterpartyEn?: string;
  readonly counterpartySw?: string;
  readonly situationEn?: string;
  readonly situationSw?: string;
  readonly objectives?: readonly ScenarioBriefingLine[];
  readonly hiddenRisks?: readonly ScenarioBriefingLine[];
  readonly rubric?: readonly ScenarioBriefingLine[];
}

export interface ScenarioView {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly titleSw: string | null;
  readonly summary: string;
  readonly summarySw: string | null;
  readonly difficulty: ScenarioDifficulty;
  readonly language: ScenarioLanguage;
  readonly conceptIds: readonly string[];
  readonly briefing: ScenarioBriefing;
  readonly estimatedMinutes: number;
  readonly roleModes: readonly ScenarioRoleMode[];
}

export interface ScenarioListResponse {
  readonly data: readonly ScenarioView[];
  readonly degraded: boolean;
}

export interface StartSessionResponse {
  readonly sessionId: string;
  readonly scenario: ScenarioView;
  readonly roleMode: ScenarioRoleMode;
}

export interface TurnReply {
  readonly en: string;
  readonly sw: string;
  readonly conceptId: string;
}

export interface TurnResponse {
  readonly reply: TurnReply | null;
  readonly coveredConceptIds: readonly string[];
  readonly objectivesTotal: number;
  readonly objectivesCovered: number;
  readonly complete: boolean;
}

export interface CompleteSessionResponse {
  readonly sessionId: string;
  readonly score: number;
  readonly passed: boolean;
}

export interface CheckpointOption {
  readonly id: string;
  readonly label: string;
  readonly isCorrect: boolean;
}

export interface CheckpointQuestion {
  readonly id: string;
  readonly conceptId: string;
  readonly prompt: string;
  readonly options: readonly CheckpointOption[];
}

export interface CheckpointResponse {
  readonly questions: readonly CheckpointQuestion[];
  readonly passThreshold?: number;
  readonly kind?: string | null;
  readonly degraded: boolean;
}

export interface CheckpointSubmitResult {
  readonly score: number;
  readonly correct: number;
  readonly total: number;
  readonly passed: boolean;
  readonly passThreshold: number;
  readonly weakConceptIds: readonly string[];
  readonly progressWritten: number;
}
