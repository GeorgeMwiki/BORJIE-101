/**
 * Trajectory record + replay.
 *
 * Inspired by SWE-agent's "agent-computer interface" (ACI) traces and
 * Cline's session export — but expressed as a simple, append-only
 * event log so the same record can be:
 *
 *   - replayed against a sandbox to verify behaviour didn't drift
 *   - used as fine-tuning data
 *   - rendered as a postmortem report
 *
 * A `TrajectoryRecorder` is a thin wrapper that callers push events
 * into. `replayTrajectory` walks the events, dispatches them to
 * injected replayers (`BrainPort` etc.), and compares outcomes.
 */

import type {
  AgentTrajectory,
  BrainPort,
  BrainRequest,
  BrainResponse,
  SandboxCommand,
  SandboxExecutionResult,
  SandboxPort,
  TrajectoryEvent,
  TrajectoryEventKind,
  VerificationReport,
} from '../types.js';

// ─────────────────────────────────────────────────────────────────
// Recorder
// ─────────────────────────────────────────────────────────────────

export interface TrajectoryRecorder {
  readonly record: (kind: TrajectoryEventKind, payload: Record<string, unknown>) => void;
  readonly snapshot: () => AgentTrajectory;
  readonly reset: () => void;
}

export interface CreateTrajectoryRecorderOptions {
  readonly sessionId: string;
  readonly now?: () => number;
}

export function createTrajectoryRecorder(
  options: CreateTrajectoryRecorderOptions,
): TrajectoryRecorder {
  const now = options.now ?? Date.now;
  let events: TrajectoryEvent[] = [];
  const startedAt = now();
  let seq = 0;

  return {
    record: (kind, payload) => {
      seq += 1;
      events.push(
        Object.freeze({
          seq,
          at: now(),
          kind,
          payload: Object.freeze({ ...payload }),
        }),
      );
    },
    snapshot: () =>
      Object.freeze({
        sessionId: options.sessionId,
        startedAt,
        endedAt: now(),
        events: Object.freeze([...events]),
      }),
    reset: () => {
      events = [];
      seq = 0;
    },
  };
}

// ─────────────────────────────────────────────────────────────────
// Brain + sandbox wrappers — auto-instrument a port to record.
// ─────────────────────────────────────────────────────────────────

export function instrumentBrain(brain: BrainPort, recorder: TrajectoryRecorder): BrainPort {
  const port: BrainPort = Object.freeze({
    generate: async (req: BrainRequest): Promise<BrainResponse> => {
      recorder.record('brain-call', { prompt: req.prompt });
      const res = await brain.generate(req);
      recorder.record('brain-call', {
        prompt: req.prompt,
        responseText: res.text,
        ...(res.usage !== undefined ? { responseUsage: res.usage } : {}),
      });
      return res;
    },
  });
  return port;
}

export function instrumentSandbox(
  sandbox: SandboxPort,
  recorder: TrajectoryRecorder,
): SandboxPort {
  const port: SandboxPort = Object.freeze({
    kind: sandbox.kind,
    exec: async (cmd: SandboxCommand): Promise<SandboxExecutionResult> => {
      recorder.record('sandbox-exec', { cmd: cmd.cmd, cwd: cmd.cwd ?? null });
      const res = await sandbox.exec(cmd);
      recorder.record('sandbox-exec', {
        cmd: cmd.cmd,
        cwd: cmd.cwd ?? null,
        exitCode: res.exitCode,
        durationMs: res.durationMs,
        timedOut: res.timedOut,
      });
      return res;
    },
    ...(sandbox.close !== undefined ? { close: sandbox.close } : {}),
  });
  return port;
}

// ─────────────────────────────────────────────────────────────────
// Replay + verify
// ─────────────────────────────────────────────────────────────────

export interface ReplayTrajectoryOptions {
  readonly trajectory: AgentTrajectory;
  /**
   * Used to deterministically re-run brain calls. The replayer is
   * given the original prompt + the expected text; it returns the
   * actual text. If undefined, brain calls are skipped (treated as
   * pass-through).
   */
  readonly brainReplay?: (params: {
    readonly prompt: string;
    readonly expected: string | undefined;
  }) => Promise<BrainResponse>;
  readonly sandbox?: SandboxPort;
}

export async function replayTrajectory(
  options: ReplayTrajectoryOptions,
): Promise<VerificationReport> {
  let matches = 0;
  let mismatches = 0;
  let missing = 0;
  let extra = 0;
  const diffs: Array<{ seq: number; reason: string }> = [];

  // Group the events into request/response pairs by kind+seq.
  const events = options.trajectory.events;
  // Strategy: every other event of the same kind is a response. We
  // walk pairs of (request, response).
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (!ev) continue;
    if (ev.kind === 'brain-call' && !ev.payload['responseText']) {
      const responseEv = events.slice(i + 1).find(
        (e) => e.kind === 'brain-call' && e.payload['prompt'] === ev.payload['prompt'],
      );
      if (!options.brainReplay) {
        matches++;
        continue;
      }
      const expectedText = (responseEv?.payload['responseText'] as string | undefined) ?? undefined;
      const actual = await options.brainReplay({
        prompt: (ev.payload['prompt'] as string | undefined) ?? '',
        expected: expectedText,
      });
      if (responseEv === undefined) {
        missing++;
        diffs.push({ seq: ev.seq, reason: 'no recorded response in trajectory' });
        continue;
      }
      if (actual.text === expectedText) matches++;
      else {
        mismatches++;
        diffs.push({ seq: ev.seq, reason: 'brain response text differs' });
      }
    } else if (ev.kind === 'sandbox-exec' && ev.payload['exitCode'] === undefined) {
      const responseEv = events
        .slice(i + 1)
        .find(
          (e) =>
            e.kind === 'sandbox-exec' && e.payload['cmd'] === ev.payload['cmd'] && e.payload['exitCode'] !== undefined,
        );
      if (!options.sandbox) {
        matches++;
        continue;
      }
      const actual: SandboxExecutionResult = await options.sandbox.exec({
        cmd: (ev.payload['cmd'] as string | undefined) ?? '',
        ...(ev.payload['cwd']
          ? { cwd: ev.payload['cwd'] as string }
          : {}),
      });
      if (responseEv === undefined) {
        missing++;
        diffs.push({ seq: ev.seq, reason: 'no recorded sandbox response in trajectory' });
        continue;
      }
      const expectedExit = responseEv.payload['exitCode'] as number | undefined;
      if (actual.exitCode === expectedExit) matches++;
      else {
        mismatches++;
        diffs.push({
          seq: ev.seq,
          reason: `sandbox exit ${actual.exitCode} != recorded ${expectedExit}`,
        });
      }
    }
  }

  return Object.freeze({
    matches,
    mismatches,
    missing,
    extra,
    diff: Object.freeze(diffs),
  });
}

// ─────────────────────────────────────────────────────────────────
// Serialize / deserialize
// ─────────────────────────────────────────────────────────────────

export function serializeTrajectory(trajectory: AgentTrajectory): string {
  return JSON.stringify(trajectory);
}

export function deserializeTrajectory(raw: string): AgentTrajectory {
  const obj = JSON.parse(raw) as AgentTrajectory;
  // Best-effort deep-freeze.
  const events = (obj.events ?? []).map((e) =>
    Object.freeze({
      seq: e.seq,
      at: e.at,
      kind: e.kind,
      payload: Object.freeze({ ...(e.payload ?? {}) }),
    }),
  );
  return Object.freeze({
    sessionId: obj.sessionId,
    startedAt: obj.startedAt,
    endedAt: obj.endedAt,
    events: Object.freeze(events),
  });
}
