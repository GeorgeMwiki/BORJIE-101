/**
 * Advisor memory — service-level facade.
 *
 * Read path: `getMemory(tenantId)` returns a populated `MemorySnapshot`
 *   the brain injects as `## OWNER_MEMORY` in the system prompt.
 *
 * Write path: `recordObservation(tenantId, observation)` normalizes
 *   the per-turn signal into one or more pattern upserts and a
 *   friction-signals delta on `advisor_preferences`. Called at the END
 *   of every turn — never blocks the SSE stream.
 *
 * `renderMemoryDirective(snapshot)` produces the natural-language
 * block the brain prompt embeds verbatim ("Owner prefers concise
 * replies. Routine: files royalty every 12th of month. Peak time:
 * 06:00-08:00.").
 */

import {
  readPreferences,
  readTopPatterns,
  upsertPattern,
  upsertPreferences,
} from './repository.js';
import {
  DEFAULT_PREFERENCES,
  type AdvisorObservation,
  type AdvisorPreferences,
  type MemorySnapshot,
  type ObservedPattern,
} from './types.js';

interface DbLike {
  execute(query: unknown): Promise<unknown>;
}

export {
  DEFAULT_PREFERENCES,
  type AdvisorObservation,
  type AdvisorPreferences,
  type MemorySnapshot,
  type ObservedPattern,
} from './types.js';

const PATTERN_LIMIT = 8;
const NORMALIZED_QUESTION_MAX = 120;

/**
 * Read snapshot. Synthesizes defaults when no preferences row exists
 * so the prompt template always has a populated object. Never throws.
 */
export async function getMemory(
  db: DbLike,
  tenantId: string,
): Promise<MemorySnapshot> {
  const [prefRaw, patterns] = await Promise.all([
    readPreferences(db, tenantId),
    readTopPatterns(db, tenantId, PATTERN_LIMIT),
  ]);
  const preferences: AdvisorPreferences = prefRaw ?? {
    tenantId,
    ...DEFAULT_PREFERENCES,
    updatedAt: new Date().toISOString(),
  };
  return Object.freeze({
    preferences,
    patterns,
  });
}

/**
 * Normalize a per-turn observation into pattern upserts plus a
 * friction-signals delta. Never throws — repository writes already
 * swallow internal errors.
 *
 * Pattern emissions per observation:
 *   1. `recurring_question` — keyed by the normalized question text.
 *   2. `peak_time` — bucketed by 2h window keyed by the local hour.
 *   3. `routine` — emitted only when the brain detected a routine action.
 *   4. `aversion` — emitted only when the brain detected a rejection.
 *
 * Friction signals are bumped on the preferences row:
 *   - bounce → dropped_turns
 *   - rejection → rejected_recommendations
 *   - long response with bounce → over_long_responses (signals the
 *     brain to shorten in future turns)
 */
export async function recordObservation(
  db: DbLike,
  observation: AdvisorObservation,
): Promise<void> {
  const tenantId = observation.tenantId;
  const ops: Array<Promise<void>> = [];

  // 1) recurring_question — text already normalized + truncated.
  const normQ = observation.normalizedQuestion
    .trim()
    .slice(0, NORMALIZED_QUESTION_MAX)
    .toLowerCase();
  if (normQ.length > 0) {
    ops.push(
      upsertPattern(
        db,
        tenantId,
        'recurring_question',
        { question: normQ, last_question_kind: observation.questionKind },
        `q:${normQ}`,
      ),
    );
  }

  // 2) peak_time — 2h windows (00-02, 02-04, ..., 22-24).
  const hour = clampHour(observation.localHour);
  const windowStart = Math.floor(hour / 2) * 2;
  const windowEnd = windowStart + 2;
  const sig = `peak:${windowStart}-${windowEnd}`;
  ops.push(
    upsertPattern(
      db,
      tenantId,
      'peak_time',
      {
        start: `${pad2(windowStart)}:00`,
        end: `${pad2(windowEnd === 24 ? 24 : windowEnd)}:00`,
      },
      sig,
    ),
  );

  // 3) routine — only when the brain detected an action this turn.
  if (observation.detectedRoutineAction) {
    const dom = observation.routineDayOfMonth;
    const routineSig = `routine:${observation.detectedRoutineAction}${
      typeof dom === 'number' ? `:dom-${dom}` : ''
    }`;
    const payload: Record<string, unknown> = {
      action: observation.detectedRoutineAction,
    };
    if (typeof dom === 'number') payload.day_of_month = dom;
    ops.push(upsertPattern(db, tenantId, 'routine', payload, routineSig));
  }

  // 4) aversion — only when the brain detected a rejection this turn.
  if (observation.rejectedRecommendationKind) {
    ops.push(
      upsertPattern(
        db,
        tenantId,
        'aversion',
        { recommendation_kind: observation.rejectedRecommendationKind },
        `aversion:${observation.rejectedRecommendationKind}`,
      ),
    );
  }

  // Friction signals — bump in the preferences row.
  const friction: Record<string, number> = {};
  if (observation.engagement === 'bounce') friction.dropped_turns = 1;
  if (observation.rejectedRecommendationKind) friction.rejected_recommendations = 1;
  if (observation.engagement === 'bounce' && observation.responseLengthChars >= 1500) {
    friction.over_long_responses = 1;
  }
  if (Object.keys(friction).length > 0) {
    ops.push(bumpFrictionSignals(db, tenantId, friction));
  }

  await Promise.all(ops);
}

/**
 * Render the natural-language memory directive injected into the brain
 * prompt as `## OWNER_MEMORY`. Returns an empty string when no signal
 * exists yet so the prompt stays compact.
 */
export function renderMemoryDirective(snapshot: MemorySnapshot): string {
  const lines: string[] = [];
  const p = snapshot.preferences;

  const styleLabel: Record<AdvisorPreferences['communicationStyle'], string> = {
    concise: 'concise replies',
    detailed: 'detailed replies with rationale',
    technical: 'technical replies with domain shorthand',
  };
  lines.push(`Owner prefers ${styleLabel[p.communicationStyle]}.`);
  if (p.language === 'sw') {
    lines.push('Owner language is Swahili (sw); reply in Swahili unless asked otherwise.');
  } else {
    lines.push('Owner language is English (en); reply in English unless asked otherwise.');
  }

  if (p.defaultBriefCadence !== 'off') {
    lines.push(`Daily-brief cadence: ${p.defaultBriefCadence}.`);
  }

  const masteryKeys = Object.keys(p.masteryLevels);
  if (masteryKeys.length > 0) {
    const masterySnippet = masteryKeys
      .slice(0, 4)
      .map((k) => `${k}=${String(p.masteryLevels[k] ?? 'novice')}`)
      .join(', ');
    lines.push(`Mastery: ${masterySnippet}.`);
  }

  // Patterns — pick the highest-salience entry per kind, render each.
  const byKind = groupByKind(snapshot.patterns);
  const routine = byKind.routine[0];
  if (routine) {
    const payload = routine.patternPayload;
    const action = String(payload.action ?? '');
    const dom = payload.day_of_month;
    if (action) {
      const when = typeof dom === 'number' ? ` around day ${dom} of the month` : '';
      lines.push(`Routine: ${action}${when}.`);
    }
  }
  const peak = byKind.peak_time[0];
  if (peak) {
    const start = String(peak.patternPayload.start ?? '');
    const end = String(peak.patternPayload.end ?? '');
    if (start && end) lines.push(`Peak interaction window: ${start}-${end}.`);
  }
  const recurring = byKind.recurring_question[0];
  if (recurring) {
    const q = String(recurring.patternPayload.question ?? '').trim();
    if (q) lines.push(`Recurring question: "${q}".`);
  }
  const aversion = byKind.aversion[0];
  if (aversion) {
    const rk = String(aversion.patternPayload.recommendation_kind ?? '').trim();
    if (rk) lines.push(`Aversion: owner has rejected "${rk}" recommendations before.`);
  }

  // Friction signals — surface the loudest counter when present.
  const fric = p.frictionSignals;
  const overLong = Number(fric.over_long_responses ?? 0);
  const dropped = Number(fric.dropped_turns ?? 0);
  const rejected = Number(fric.rejected_recommendations ?? 0);
  if (overLong >= 2) {
    lines.push('Friction: owner has bounced from long replies before; keep it tight.');
  }
  if (rejected >= 2) {
    lines.push('Friction: owner has rejected multiple recommendations; ground every suggestion in cited evidence.');
  }
  if (dropped >= 5 && overLong < 2) {
    lines.push('Friction: owner often drops mid-thread; lead with the headline number.');
  }

  return lines.join(' ');
}

// ────────────────────────────────────────────────────────────────────
// Internals

function clampHour(h: number): number {
  if (!Number.isFinite(h)) return 12;
  const n = Math.trunc(h);
  if (n < 0) return 0;
  if (n > 23) return 23;
  return n;
}

function pad2(n: number): string {
  if (n >= 24) return '24';
  return n < 10 ? `0${n}` : String(n);
}

function groupByKind(patterns: ReadonlyArray<ObservedPattern>): Readonly<{
  routine: ReadonlyArray<ObservedPattern>;
  aversion: ReadonlyArray<ObservedPattern>;
  peak_time: ReadonlyArray<ObservedPattern>;
  recurring_question: ReadonlyArray<ObservedPattern>;
}> {
  const routine: ObservedPattern[] = [];
  const aversion: ObservedPattern[] = [];
  const peak_time: ObservedPattern[] = [];
  const recurring_question: ObservedPattern[] = [];
  for (const p of patterns) {
    switch (p.patternKind) {
      case 'routine':
        routine.push(p);
        break;
      case 'aversion':
        aversion.push(p);
        break;
      case 'peak_time':
        peak_time.push(p);
        break;
      case 'recurring_question':
        recurring_question.push(p);
        break;
    }
  }
  return Object.freeze({ routine, aversion, peak_time, recurring_question });
}

async function bumpFrictionSignals(
  db: DbLike,
  tenantId: string,
  delta: Record<string, number>,
): Promise<void> {
  const prev = await readPreferences(db, tenantId);
  const baseFriction = prev?.frictionSignals ?? {};
  const next: Record<string, number> = { ...baseFriction };
  for (const [k, v] of Object.entries(delta)) {
    next[k] = Number(next[k] ?? 0) + Number(v ?? 0);
  }
  // Preserve other fields verbatim when prev exists (the upsert COALESCEs
  // scalars). Build the patch immutably to honour `readonly` invariants.
  const patch: Partial<Omit<AdvisorPreferences, 'tenantId' | 'updatedAt'>> =
    prev
      ? {
          frictionSignals: next,
          preferredChannels: prev.preferredChannels,
          doNotDisturb: prev.doNotDisturb,
          masteryLevels: prev.masteryLevels,
        }
      : { frictionSignals: next };
  await upsertPreferences(db, tenantId, patch);
}
