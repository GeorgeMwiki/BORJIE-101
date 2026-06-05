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

import { getApiClient, ApiResponse, RequestOptions } from '../client';

// Type shapes live in a pure-type module (zero runtime/client imports) so the
// `@borjie/api-client/training-types` alias can resolve them without dragging
// `../client` into a strict app typecheck. Re-exported here to keep the runtime
// service and its typed contract single-sourced.
export type {
  ScenarioLanguage,
  ScenarioDifficulty,
  ScenarioRoleMode,
  ScenarioBriefingLine,
  ScenarioBriefing,
  ScenarioView,
  ScenarioListResponse,
  StartSessionResponse,
  TurnReply,
  TurnResponse,
  CompleteSessionResponse,
  CheckpointOption,
  CheckpointQuestion,
  CheckpointResponse,
  CheckpointSubmitResult,
} from './training-scenarios.types';

import type {
  ScenarioLanguage,
  ScenarioDifficulty,
  ScenarioRoleMode,
  ScenarioView,
  ScenarioListResponse,
  StartSessionResponse,
  TurnResponse,
  CompleteSessionResponse,
  CheckpointResponse,
  CheckpointSubmitResult,
} from './training-scenarios.types';

export const trainingScenariosService = {
  /** List active scenario templates for the tenant. */
  list(language?: ScenarioLanguage): Promise<ApiResponse<ScenarioListResponse>> {
    const options: RequestOptions = {};
    if (language) options.params = { language };
    return getApiClient().get<ScenarioListResponse>('/scenarios', options);
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
    const options: RequestOptions = {};
    if (Object.keys(params).length > 0) options.params = params;
    return getApiClient().get<CheckpointResponse>('/scenarios/checkpoint', options);
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
