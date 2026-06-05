/**
 * Training-scenarios service — client for /api/v1/scenarios/*.
 *
 * Backs the owner-web cockpit training surfaces:
 *   - /training/scenarios   (scenario simulation)
 *   - /training/checkpoint  (mastery checkpoint w/ BKT gating)
 *
 * Every call returns the gateway's `{ success, data, ... }` envelope. The
 * gateway honest-degrades (503 when no live DB; `degraded: true` when no
 * catalog concept resolves) — callers surface an empty state, never fabricate.
 *
 * The owner-web pages also drive these endpoints natively via `gatewayFetch`
 * (their house data-layer convention); this service is the canonical typed
 * contract reused for the TYPE shapes (imported through the
 * `@borjie/api-client/training-types` tsconfig path alias). Importing VALUE
 * (`trainingScenariosService`) goes through the barrel; importing TYPES goes
 * through the alias — sidestepping the NodeNext barrel-resolution pitfall.
 *
 * Ported from the BossNyumba training-scenarios service and retargeted
 * real-estate -> mining (role-modes: compliance / finance / safety /
 * commercial / operations).
 */

import { getApiClient, ApiResponse } from '../client';

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

export const trainingScenariosService = {
  /** List active scenario templates for the tenant. */
  list(language?: ScenarioLanguage): Promise<ApiResponse<ScenarioListResponse>> {
    return getApiClient().get<ScenarioListResponse>('/scenarios', {
      params: language ? { language } : undefined,
    });
  },

  /** (Re)generate templates from the concept catalog. */
  generate(input: {
    difficulty?: ScenarioDifficulty;
    language?: ScenarioLanguage;
  }): Promise<ApiResponse<readonly ScenarioView[]>> {
    return getApiClient().post<readonly ScenarioView[]>('/scenarios/generate', input);
  },

  /** Start a run. Role-mode is validated server-side (admin-locked). */
  startSession(input: {
    scenarioId: string;
    roleMode?: ScenarioRoleMode;
  }): Promise<ApiResponse<StartSessionResponse>> {
    return getApiClient().post<StartSessionResponse>('/scenarios/sessions', input);
  },

  /** Append a transcript turn. */
  turn(
    sessionId: string,
    input: { message: string; coveredConceptIds?: readonly string[] },
  ): Promise<ApiResponse<TurnResponse>> {
    return getApiClient().post<TurnResponse>(
      `/scenarios/sessions/${sessionId}/turn`,
      input,
    );
  },

  /** Close a run with a final score. */
  complete(
    sessionId: string,
    input: { score: number; coveredConceptIds?: readonly string[]; notes?: string },
  ): Promise<ApiResponse<CompleteSessionResponse>> {
    return getApiClient().post<CompleteSessionResponse>(
      `/scenarios/sessions/${sessionId}/complete`,
      input,
    );
  },

  /** Build a checkpoint (inverse-BKT weighted) for a phase/kind. */
  checkpoint(input?: {
    kind?: string;
    language?: ScenarioLanguage;
  }): Promise<ApiResponse<CheckpointResponse>> {
    const params: Record<string, string> = {};
    if (input?.kind) params.kind = input.kind;
    if (input?.language) params.language = input.language;
    return getApiClient().get<CheckpointResponse>('/scenarios/checkpoint', {
      params: Object.keys(params).length > 0 ? params : undefined,
    });
  },

  /** Submit checkpoint results; 0.7 pass gates the next phase. */
  submitCheckpoint(input: {
    conceptIds: readonly string[];
    results: ReadonlyArray<{ conceptId: string; correct: boolean }>;
  }): Promise<ApiResponse<CheckpointSubmitResult>> {
    return getApiClient().post<CheckpointSubmitResult>(
      '/scenarios/checkpoint/submit',
      input,
    );
  },
};
