'use client';

/**
 * Training-mode context — drives an interactive scenario-simulation run
 * (gap 9, owner-web /training/scenarios).
 *
 * Holds the live session state for ONE scenario run: the transcript, the
 * objective-coverage the backend reports, the elapsed timer (decision-capture
 * timing), and the final score. Every server call goes through the native
 * `training-gateway` fetch layer, which targets the gateway's
 * /api/v1/scenarios/* routes.
 *
 * HONEST-DEGRADE: the gateway throws a typed `TrainingGatewayError` on 503
 * (service unavailable) / 403 (forbidden role-mode) / 404. Those surface here
 * as `state.error` with a machine-readable `state.errorStatus` so the page can
 * render a graceful unavailable / locked state — never fabricated content.
 *
 * Admin-locked role-mode: the chosen `roleMode` is sent to the server, which
 * validates it against the scenario kind's allowlist. A client cannot
 * self-grant a mode; a rejected mode comes back as HTTP 403.
 *
 * Ported (shape-only) from the BN training-mode context and retargeted to the
 * owner-web native-fetch + dark-theme house style.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from 'react';
import {
  startSession,
  sendTurn,
  completeSession,
  TrainingGatewayError,
  type ScenarioView,
  type ScenarioRoleMode,
  type TurnReply,
} from './training-gateway';

/** One transcript line in a run. `learner` is the operator; `reply` is grounded. */
export interface TranscriptTurn {
  readonly id: string;
  readonly learner: string;
  readonly reply: TurnReply | null;
  readonly at: string;
}

export type SessionPhase = 'briefing' | 'active' | 'complete';

export interface TrainingState {
  readonly scenario: ScenarioView | null;
  readonly roleMode: ScenarioRoleMode | null;
  readonly sessionId: string | null;
  readonly phase: SessionPhase;
  readonly transcript: readonly TranscriptTurn[];
  readonly coveredConceptIds: readonly string[];
  readonly objectivesTotal: number;
  readonly objectivesCovered: number;
  readonly isSending: boolean;
  readonly isStarting: boolean;
  readonly elapsedMs: number;
  readonly score: number | null;
  readonly passed: boolean | null;
  /** Human-readable error (already localized by the caller-supplied messages). */
  readonly error: string | null;
  /** HTTP status so the page can branch (e.g. 503 unavailable, 403 role lock). */
  readonly errorStatus: number | null;
}

const INITIAL_STATE: TrainingState = {
  scenario: null,
  roleMode: null,
  sessionId: null,
  phase: 'briefing',
  transcript: [],
  coveredConceptIds: [],
  objectivesTotal: 0,
  objectivesCovered: 0,
  isSending: false,
  isStarting: false,
  elapsedMs: 0,
  score: null,
  passed: null,
  error: null,
  errorStatus: null,
};

type Action =
  | { readonly type: 'start_pending'; readonly scenario: ScenarioView; readonly roleMode: ScenarioRoleMode | null }
  | {
      readonly type: 'start_ok';
      readonly sessionId: string;
      readonly scenario: ScenarioView;
      readonly roleMode: ScenarioRoleMode;
      readonly objectivesTotal: number;
    }
  | { readonly type: 'send_pending'; readonly turn: TranscriptTurn }
  | {
      readonly type: 'send_ok';
      readonly reply: TurnReply | null;
      readonly coveredConceptIds: readonly string[];
      readonly objectivesTotal: number;
      readonly objectivesCovered: number;
    }
  | { readonly type: 'complete_ok'; readonly score: number; readonly passed: boolean }
  | { readonly type: 'tick'; readonly elapsedMs: number }
  | { readonly type: 'error'; readonly message: string; readonly status: number | null }
  | { readonly type: 'reset' };

function reducer(state: TrainingState, action: Action): TrainingState {
  switch (action.type) {
    case 'start_pending':
      return {
        ...INITIAL_STATE,
        scenario: action.scenario,
        roleMode: action.roleMode,
        isStarting: true,
      };
    case 'start_ok':
      return {
        ...state,
        sessionId: action.sessionId,
        scenario: action.scenario,
        roleMode: action.roleMode,
        objectivesTotal: action.objectivesTotal,
        phase: 'active',
        isStarting: false,
        error: null,
        errorStatus: null,
      };
    case 'send_pending':
      return {
        ...state,
        transcript: [...state.transcript, action.turn],
        isSending: true,
        error: null,
        errorStatus: null,
      };
    case 'send_ok': {
      const transcript = updateLastReply(state.transcript, action.reply);
      return {
        ...state,
        transcript,
        coveredConceptIds: action.coveredConceptIds,
        objectivesTotal: action.objectivesTotal,
        objectivesCovered: action.objectivesCovered,
        isSending: false,
      };
    }
    case 'complete_ok':
      return {
        ...state,
        phase: 'complete',
        score: action.score,
        passed: action.passed,
        isSending: false,
      };
    case 'tick':
      return { ...state, elapsedMs: action.elapsedMs };
    case 'error':
      return {
        ...state,
        isSending: false,
        isStarting: false,
        error: action.message,
        errorStatus: action.status,
      };
    case 'reset':
      return INITIAL_STATE;
    default:
      return state;
  }
}

/** Attach the grounded reply to the most recent (optimistic) learner turn. */
function updateLastReply(
  transcript: readonly TranscriptTurn[],
  reply: TurnReply | null,
): readonly TranscriptTurn[] {
  if (transcript.length === 0) return transcript;
  return transcript.map((turn, i) =>
    i === transcript.length - 1 ? { ...turn, reply } : turn,
  );
}

export interface TrainingContextValue {
  readonly state: TrainingState;
  /** Start a run. Role-mode (if any) is validated server-side. */
  readonly start: (scenario: ScenarioView, roleMode: ScenarioRoleMode | null) => Promise<void>;
  /** Send a learner turn; the grounded counterparty reply streams back. */
  readonly send: (message: string) => Promise<void>;
  /** Close the run with a final score in [0, 1]. */
  readonly complete: (score: number) => Promise<void>;
  /** Tear the run down (return to the browser). */
  readonly reset: () => void;
}

const TrainingContext = createContext<TrainingContextValue | null>(null);

export interface TrainingProviderProps {
  /** Localized fallback used when a thrown error carries no message. */
  readonly genericErrorMessage: string;
  readonly children: ReactNode;
}

export function TrainingProvider({
  genericErrorMessage,
  children,
}: TrainingProviderProps) {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const startedAtRef = useRef<number | null>(null);

  // Decision-capture timer: tick once a second while a run is active. The
  // elapsed time is fed into the completion score so a fast, accurate run
  // scores better than a slow one.
  useEffect(() => {
    if (state.phase !== 'active') {
      startedAtRef.current = null;
      return;
    }
    startedAtRef.current = Date.now();
    const id = window.setInterval(() => {
      if (startedAtRef.current === null) return;
      dispatch({ type: 'tick', elapsedMs: Date.now() - startedAtRef.current });
    }, 1000);
    return () => window.clearInterval(id);
  }, [state.phase]);

  const toError = useCallback(
    (err: unknown): { message: string; status: number | null } => {
      if (err instanceof TrainingGatewayError) {
        return {
          message: err.message.trim() ? err.message : genericErrorMessage,
          status: err.status,
        };
      }
      const e = err as { message?: string } | null;
      return {
        message: e?.message?.trim() ? e.message : genericErrorMessage,
        status: null,
      };
    },
    [genericErrorMessage],
  );

  const start = useCallback(
    async (scenario: ScenarioView, roleMode: ScenarioRoleMode | null) => {
      dispatch({ type: 'start_pending', scenario, roleMode });
      try {
        const data = await startSession(scenario.id, roleMode);
        dispatch({
          type: 'start_ok',
          sessionId: data.sessionId,
          scenario: data.scenario,
          roleMode: data.roleMode,
          objectivesTotal: data.scenario.briefing.objectives?.length ?? 0,
        });
      } catch (err) {
        const { message, status } = toError(err);
        dispatch({ type: 'error', message, status });
      }
    },
    [toError],
  );

  const send = useCallback(
    async (message: string) => {
      const sessionId = state.sessionId;
      if (!sessionId || state.isSending) return;
      const turn: TranscriptTurn = {
        id: `t-${Date.now()}`,
        learner: message,
        reply: null,
        at: new Date().toISOString(),
      };
      dispatch({ type: 'send_pending', turn });
      try {
        const data = await sendTurn(sessionId, message, []);
        dispatch({
          type: 'send_ok',
          reply: data.reply,
          coveredConceptIds: data.coveredConceptIds,
          objectivesTotal: data.objectivesTotal,
          objectivesCovered: data.objectivesCovered,
        });
      } catch (err) {
        const { message: m, status } = toError(err);
        dispatch({ type: 'error', message: m, status });
      }
    },
    [state.sessionId, state.isSending, toError],
  );

  const complete = useCallback(
    async (score: number) => {
      const sessionId = state.sessionId;
      if (!sessionId) return;
      try {
        const data = await completeSession(sessionId, score, state.coveredConceptIds);
        dispatch({ type: 'complete_ok', score: data.score, passed: data.passed });
      } catch (err) {
        const { message, status } = toError(err);
        dispatch({ type: 'error', message, status });
      }
    },
    [state.sessionId, state.coveredConceptIds, toError],
  );

  const reset = useCallback(() => dispatch({ type: 'reset' }), []);

  const value = useMemo<TrainingContextValue>(
    () => ({ state, start, send, complete, reset }),
    [state, start, send, complete, reset],
  );

  return <TrainingContext.Provider value={value}>{children}</TrainingContext.Provider>;
}

export function useTraining(): TrainingContextValue {
  const ctx = useContext(TrainingContext);
  if (!ctx) {
    throw new Error('useTraining must be used within a <TrainingProvider>');
  }
  return ctx;
}
