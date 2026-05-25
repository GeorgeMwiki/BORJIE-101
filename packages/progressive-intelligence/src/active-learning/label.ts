/**
 * Label request + label incorporation.
 *
 * `requestLabel` builds a `LabelRequest` envelope the caller persists
 * (DB / queue) or routes to an LLM jury.
 *
 * `incorporateLabel` updates a tiny `UpdatedModel` accumulator with the
 * new label. Pure — the caller persists the result. Tracks total
 * cases, labeled cases, and the agreement rate across labels for the
 * same caseId (human vs jury).
 */
import type {
  Label,
  LabelOracle,
  LabelRequest,
  UncertainCase,
  UpdatedModel,
} from '../types.js';

export interface RequestLabelArgs<T = unknown> {
  readonly case: UncertainCase<T>;
  readonly oracle: LabelOracle;
  readonly now?: () => Date;
  readonly note?: string;
}

export function requestLabel<T = unknown>(
  args: RequestLabelArgs<T>,
): LabelRequest<T> {
  const now = (args.now ?? (() => new Date()))();
  return {
    caseId: args.case.id,
    oracle: args.oracle,
    requestedAt: now.toISOString(),
    prediction: args.case.prediction,
    ...(args.note !== undefined ? { note: args.note } : {}),
  };
}

export interface IncorporateLabelArgs<T = unknown> {
  readonly label: Label<T>;
  readonly model: UpdatedModel<T>;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * Append the label to the accumulator. Pure: returns a new model.
 *
 * Agreement is computed per caseId — when two or more oracles agree on
 * the same caseId's value, agreement counts up. If they disagree it
 * counts down. We treat single-oracle cases as fully agreeing
 * (numerator and denominator both bump), which matches Cleanlab's
 * "treat sole labels as confident" default.
 */
export function incorporateLabel<T = unknown>(
  args: IncorporateLabelArgs<T>,
): UpdatedModel<T> {
  const labels: Label<T>[] = [...args.model.labels, args.label];
  const byCase = new Map<string, Label<T>[]>();
  for (const l of labels) {
    const arr = byCase.get(l.caseId);
    if (arr) arr.push(l);
    else byCase.set(l.caseId, [l]);
  }
  let agreed = 0;
  let counted = 0;
  for (const [, arr] of byCase) {
    counted += 1;
    if (arr.length === 1) {
      agreed += 1;
      continue;
    }
    // multi-oracle: agree iff every label value matches
    const first = (arr[0] as Label<T>).value;
    if (arr.every((l) => deepEqual(l.value, first))) {
      agreed += 1;
    }
  }
  const agreementRate = counted === 0 ? 0 : agreed / counted;
  return {
    version: args.model.version + 1,
    totalCases: Math.max(args.model.totalCases, byCase.size),
    labeledCases: byCase.size,
    agreementRate,
    labels,
  };
}

/** Empty initial model for callers bootstrapping a fresh accumulator. */
export function emptyModel<T = unknown>(totalCases = 0): UpdatedModel<T> {
  return {
    version: 0,
    totalCases,
    labeledCases: 0,
    agreementRate: 0,
    labels: [],
  };
}
