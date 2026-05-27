/**
 * Typed errors for the mining-shift-planner.
 *
 * Stable `code` for cross-process matching; `details` carry
 * safe-to-log context.
 */

export type ShiftPlannerErrorCode =
  | 'OVERLOADED_SCHEDULE'
  | 'OSHA_VIOLATION'
  | 'FATIGUE_EXCEEDED'
  | 'INVALID_INPUT';

export class ShiftPlannerError extends Error {
  readonly code: ShiftPlannerErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: ShiftPlannerErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = 'ShiftPlannerError';
    this.code = code;
    this.details = details;
  }
}

export class OverloadedScheduleError extends ShiftPlannerError {
  constructor(unfilled: number, total: number) {
    super(
      'OVERLOADED_SCHEDULE',
      `Cannot fill ${unfilled}/${total} tasks with available workers/equipment`,
      { unfilled, total },
    );
    this.name = 'OverloadedScheduleError';
  }
}

export class OshaViolationError extends ShiftPlannerError {
  constructor(violations: ReadonlyArray<string>) {
    super(
      'OSHA_VIOLATION',
      `OSHA-TZ violation${violations.length > 1 ? 's' : ''}: ${violations.join('; ')}`,
      { violations },
    );
    this.name = 'OshaViolationError';
  }
}

export class FatigueExceededError extends ShiftPlannerError {
  constructor(workerId: string, score: number) {
    super(
      'FATIGUE_EXCEEDED',
      `Worker ${workerId} fatigue score ${score.toFixed(2)} exceeds threshold`,
      { workerId, score },
    );
    this.name = 'FatigueExceededError';
  }
}
