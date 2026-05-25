/**
 * Behaviour observer
 *
 * Zero-PII, zero-LLM statistical observer that watches user interaction
 * signals (time-on-page, idle duration, field errors, backtracking, rapid
 * deletion) and decides when a proactive intervention is warranted.
 *
 * Purely event-driven — no timers escape the class. Cross-tenant isolation
 * is enforced by keying all state on (tenantId, userId).
 */

import {
  DEFAULT_OBSERVER_CONFIG,
  type BehaviorEvent,
  type ObserverConfig,
  type ProactiveIntervention,
} from './types.js';

interface PerUserState {
  readonly tenantId: string;
  readonly userId: string;
  readonly events: readonly BehaviorEvent[];
  readonly fieldErrorCounts: Readonly<Record<string, number>>;
  readonly lastInterventions: Readonly<Record<string, string>>;
  readonly interventionTimestamps: readonly string[];
}

type Subscriber = (intervention: ProactiveIntervention) => void;

const MAX_HISTORY = 200;

export class BehaviorObserver {
  private readonly states = new Map<string, PerUserState>();
  private readonly subscribers: Subscriber[] = [];
  private readonly config: ObserverConfig;

  constructor(config: Partial<ObserverConfig> = {}) {
    this.config = { ...DEFAULT_OBSERVER_CONFIG, ...config };
  }

  subscribe(subscriber: Subscriber): () => void {
    this.subscribers.push(subscriber);
    return () => {
      const idx = this.subscribers.indexOf(subscriber);
      if (idx >= 0) this.subscribers.splice(idx, 1);
    };
  }

  /** Record a single behaviour event. Never mutates inputs. */
  record(event: BehaviorEvent): readonly ProactiveIntervention[] {
    const key = this.key(event.tenantId, event.userId);
    const prev = this.states.get(key) ?? this.empty(event);
    const events = [...prev.events, event].slice(-MAX_HISTORY);

    const next: PerUserState = {
      ...prev,
      events,
      fieldErrorCounts: this.updateErrorCounts(prev, event),
    };

    const interventions = this.detectInterventions(next, event);
    const after = this.applyInterventions(next, interventions);

    this.states.set(key, after);

    for (const intervention of interventions) {
      for (const s of this.subscribers) {
        try {
          s(intervention);
        } catch {
          // subscriber error ignored
        }
      }
    }

    return interventions;
  }

  getAnalytics(tenantId: string, userId: string): BehaviorAnalytics {
    const state = this.states.get(this.key(tenantId, userId));
    if (!state) {
      return {
        totalEvents: 0,
        errorRate: 0,
        interventionCount: 0,
        problematicFields: [],
      };
    }
    const totalEvents = state.events.length;
    const errors = state.events.filter((e) => e.type === 'field_error').length;
    const fields = new Set(state.events.map((e) => e.fieldId).filter(Boolean))
      .size;
    const errorRate = fields > 0 ? errors / fields : 0;
    const problematicFields = Object.entries(state.fieldErrorCounts)
      .map(([fieldId, errorCount]) => ({ fieldId, errorCount }))
      .sort((a, b) => b.errorCount - a.errorCount)
      .slice(0, 5);
    return {
      totalEvents,
      errorRate,
      interventionCount: state.interventionTimestamps.length,
      problematicFields,
    };
  }

  reset(tenantId: string, userId: string): void {
    this.states.delete(this.key(tenantId, userId));
  }

  private empty(event: BehaviorEvent): PerUserState {
    return {
      tenantId: event.tenantId,
      userId: event.userId,
      events: [],
      fieldErrorCounts: {},
      lastInterventions: {},
      interventionTimestamps: [],
    };
  }

  private updateErrorCounts(
    prev: PerUserState,
    event: BehaviorEvent,
  ): Readonly<Record<string, number>> {
    if (event.type === 'field_error' && event.fieldId) {
      return {
        ...prev.fieldErrorCounts,
        [event.fieldId]: (prev.fieldErrorCounts[event.fieldId] ?? 0) + 1,
      };
    }
    if (event.type === 'field_success' && event.fieldId) {
      const next = { ...prev.fieldErrorCounts };
      delete next[event.fieldId];
      return next;
    }
    return prev.fieldErrorCounts;
  }

  private detectInterventions(
    state: PerUserState,
    event: BehaviorEvent,
  ): readonly ProactiveIntervention[] {
    const interventions: ProactiveIntervention[] = [];
    if (!this.withinRateLimit(state)) return interventions;

    // Idle on field: the user has been staring at a single field > threshold.
    if (event.type === 'idle' && event.fieldId) {
      const durationMs = event.durationMs ?? 0;
      const trigger = `idle_${event.fieldId}`;
      if (
        durationMs >= this.config.idleThresholdMs &&
        this.canTrigger(state, trigger)
      ) {
        interventions.push(
          this.build(event, 'offer_help', trigger, 'medium', {
            en: `I notice you're thinking about ${event.fieldName ?? 'this field'} \u2014 want me to walk you through it?`,
            sw: `Naona unafikiria kuhusu ${event.fieldName ?? 'sehemu hii'} \u2014 ungependa nikueleze?`,
          }),
        );
      }
    }

    // Repeated errors on the same field (counts already include this event).
    if (event.type === 'field_error' && event.fieldId) {
      const count = state.fieldErrorCounts[event.fieldId] ?? 0;
      const trigger = `error_${event.fieldId}`;
      if (
        count >= this.config.errorCountThreshold &&
        this.canTrigger(state, trigger)
      ) {
        interventions.push(
          this.build(event, 'explain_field', trigger, 'high', {
            en: `This field seems tricky. Let me explain what ${event.fieldName ?? 'it'} expects.`,
            sw: `Sehemu hii inaonekana ngumu. Niruhusu nieleze ${event.fieldName ?? 'inatarajia nini'}.`,
          }),
        );
      }
    }

    // Backtracking between sections.
    if (event.type === 'navigation_back') {
      const recentBacks = state.events
        .filter((e) => e.type === 'navigation_back')
        .filter((e) => {
          const age = Date.now() - new Date(e.timestamp).getTime();
          return age < 60_000;
        });
      if (
        recentBacks.length >= this.config.backtrackThreshold &&
        this.canTrigger(state, 'backtracking')
      ) {
        interventions.push(
          this.build(event, 'offer_help', 'backtracking', 'medium', {
            en: 'You seem to be looking for something \u2014 want me to summarise what we have so far?',
            sw: 'Inaonekana unatafuta kitu \u2014 ungependa nikufupishe tulichonacho hadi sasa?',
          }),
        );
      }
    }

    // Form submit attempt \u2014 confirm before firing.
    if (event.type === 'form_submit_attempt' && this.canTrigger(state, 'submit_confirm')) {
      interventions.push(
        this.build(event, 'confirm_action', 'submit_confirm', 'high', {
          en: 'Ready to submit? I can run a final check for you.',
          sw: 'Uko tayari kutuma? Ninaweza kufanya ukaguzi wa mwisho.',
        }),
      );
    }

    // Section milestone complete \u2014 a quick celebration.
    if (event.type === 'section_complete') {
      const trigger = `milestone_${event.sectionId ?? 'unknown'}`;
      if (this.canTrigger(state, trigger)) {
        interventions.push(
          this.build(event, 'celebrate_progress', trigger, 'low', {
            en: `Nice \u2014 ${event.sectionId ?? 'that section'} is done.`,
            sw: `Vizuri \u2014 ${event.sectionId ?? 'sehemu hiyo'} imekamilika.`,
          }),
        );
      }
    }

    // Rapid deletion pattern suggests confusion.
    if (event.type === 'rapid_deletion') {
      const recent = state.events.filter(
        (e) =>
          e.type === 'rapid_deletion' &&
          Date.now() - new Date(e.timestamp).getTime() < 10_000,
      );
      if (recent.length >= 5 && this.canTrigger(state, 'confusion')) {
        interventions.push(
          this.build(event, 'offer_help', 'confusion_pattern', 'medium', {
            en: 'Looks like this is not coming out how you want \u2014 can I help rewrite it?',
            sw: 'Inaonekana haitoki unavyotaka \u2014 naweza kusaidia kuandika upya?',
          }),
        );
      }
    }

    return interventions;
  }

  private applyInterventions(
    state: PerUserState,
    interventions: readonly ProactiveIntervention[],
  ): PerUserState {
    if (interventions.length === 0) return state;
    const lastInterventions = { ...state.lastInterventions };
    for (const i of interventions) {
      lastInterventions[i.trigger] = i.createdAt;
    }
    const interventionTimestamps = [
      ...state.interventionTimestamps,
      ...interventions.map((i) => i.createdAt),
    ].slice(-30);
    return {
      ...state,
      lastInterventions,
      interventionTimestamps,
    };
  }

  private canTrigger(state: PerUserState, trigger: string): boolean {
    const last = state.lastInterventions[trigger];
    if (!last) return true;
    return (
      Date.now() - new Date(last).getTime() >= this.config.interventionCooldownMs
    );
  }

  private withinRateLimit(state: PerUserState): boolean {
    const oneMinuteAgo = Date.now() - 60_000;
    const recent = state.interventionTimestamps.filter(
      (ts) => new Date(ts).getTime() > oneMinuteAgo,
    );
    return recent.length < this.config.maxInterventionsPerMinute;
  }

  private build(
    event: BehaviorEvent,
    type: ProactiveIntervention['type'],
    trigger: string,
    priority: ProactiveIntervention['priority'],
    messages: { en: string; sw: string },
  ): ProactiveIntervention {
    return {
      id: `int_${event.tenantId}_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2, 8)}`,
      tenantId: event.tenantId,
      userId: event.userId,
      type,
      trigger,
      priority,
      message: messages.en,
      messageSwahili: messages.sw,
      fieldId: event.fieldId,
      sectionId: event.sectionId,
      createdAt: new Date().toISOString(),
      cooldownMs: this.config.interventionCooldownMs,
    };
  }

  private key(tenantId: string, userId: string): string {
    return `${tenantId}::${userId}`;
  }
}

export interface BehaviorAnalytics {
  readonly totalEvents: number;
  readonly errorRate: number;
  readonly interventionCount: number;
  readonly problematicFields: readonly {
    readonly fieldId: string;
    readonly errorCount: number;
  }[];
}

// ─────────────────────────────────────────────────────────────────────
// Server-side sensorium aggregator (Central Command Phase A — C4).
//
// The legacy `BehaviorObserver` (above) is a per-request HTTP middleware
// that tracks form-error rates in process memory. The wiring below
// completes the audit gap (#3 in `2025-bn-internal-gap-audit.md`) by
// turning the database-backed `sensorium_event_log` into a stream of
// derived brain-mind-state signals the kernel reads at step 4 (memory
// recall). The kernel never sees raw mouse/scroll/click rows — it sees:
//
//   - `engagement.high`              — many element.click + scroll.depth + dwell.time in a short window
//   - `frustration.detected`         — error.boundary spike OR repeated input.change with hasPii flips
//   - `task.completed-without-AI`    — form.submit with no preceding /ask or /jarvis network call
//   - `dwell.deep`                   — dwell.time exceeded N seconds on a single route
//
// The factory is duck-typed against a `SensoriumEventLogSource` port
// so the production composition root can bind the Drizzle service
// without the ai-copilot package compile-time-depending on @borjie/
// database. Tests pass in an in-memory fake.
// ─────────────────────────────────────────────────────────────────────

export type BehaviorSignalKind =
  | 'engagement.high'
  | 'engagement.low'
  | 'frustration.detected'
  | 'task.completed-without-AI'
  | 'dwell.deep';

export interface BehaviorSignal {
  readonly kind: BehaviorSignalKind;
  readonly route: string;
  readonly capturedAt: string;
  readonly evidence: Readonly<Record<string, number>>;
}

/**
 * Minimal shape the production `sensorium-event-log.service` already
 * satisfies. Duck-typed locally so this package stays free of a
 * @borjie/database dep.
 */
export interface SensoriumEventLogSource {
  countByTypeForUser(args: {
    tenantId: string;
    userId: string;
    windowMinutes?: number;
  }): Promise<Record<string, number>>;
  listForSession(args: {
    tenantId: string;
    userId: string;
    sessionId: string;
    windowMinutes?: number;
    limit?: number;
  }): Promise<
    ReadonlyArray<{
      eventType: string;
      route: string;
      emittedAt: string;
      payload: Record<string, unknown>;
    }>
  >;
}

export interface BehaviorSignalSource {
  /**
   * Derive a list of signals for one user over the last N minutes
   * (default 15). Pure read — never mutates state. Returns [] on any
   * upstream failure so the kernel turn never breaks on a missing
   * sensorium row.
   */
  signalsForUser(args: {
    readonly tenantId: string;
    readonly userId: string;
    readonly windowMinutes?: number;
  }): Promise<ReadonlyArray<BehaviorSignal>>;

  /**
   * Same signal derivation, scoped to a single (tenant, user, session).
   * Used by surfaces that have a session id (the client-side bus emits
   * one per tab); produces sharper signals because it can read the
   * full event ribbon, not just the histogram.
   */
  signalsForSession(args: {
    readonly tenantId: string;
    readonly userId: string;
    readonly sessionId: string;
    readonly windowMinutes?: number;
  }): Promise<ReadonlyArray<BehaviorSignal>>;
}

export interface BehaviorSignalConfig {
  /** Total events ≥ this triggers engagement.high. Default 25. */
  readonly engagementHighThreshold: number;
  /** Total events ≤ this in 15 min triggers engagement.low. Default 2. */
  readonly engagementLowThreshold: number;
  /** error.boundary count ≥ this triggers frustration.detected. Default 2. */
  readonly errorFrustrationThreshold: number;
  /** dwell.time ≥ this ms triggers dwell.deep. Default 60_000 (1 min). */
  readonly dwellDeepMs: number;
}

export const DEFAULT_BEHAVIOR_SIGNAL_CONFIG: BehaviorSignalConfig = {
  engagementHighThreshold: 25,
  engagementLowThreshold: 2,
  errorFrustrationThreshold: 2,
  dwellDeepMs: 60_000,
};

export function createBehaviorSignalSource(
  source: SensoriumEventLogSource,
  config: Partial<BehaviorSignalConfig> = {},
): BehaviorSignalSource {
  const cfg = { ...DEFAULT_BEHAVIOR_SIGNAL_CONFIG, ...config };

  function deriveFromHistogram(
    histogram: Record<string, number>,
    route: string,
  ): BehaviorSignal[] {
    const out: BehaviorSignal[] = [];
    const now = new Date().toISOString();
    const total = Object.values(histogram).reduce((acc, n) => acc + n, 0);
    const errorCount = histogram['error.boundary'] ?? 0;
    const submitCount = histogram['form.submit'] ?? 0;
    const networkFailures = histogram['network.request'] ?? 0;

    if (total >= cfg.engagementHighThreshold) {
      out.push({
        kind: 'engagement.high',
        route,
        capturedAt: now,
        evidence: { total },
      });
    } else if (total <= cfg.engagementLowThreshold) {
      out.push({
        kind: 'engagement.low',
        route,
        capturedAt: now,
        evidence: { total },
      });
    }

    if (errorCount >= cfg.errorFrustrationThreshold) {
      out.push({
        kind: 'frustration.detected',
        route,
        capturedAt: now,
        evidence: { errorCount, networkFailures },
      });
    }

    if (submitCount > 0 && networkFailures === 0 && total > 0) {
      out.push({
        kind: 'task.completed-without-AI',
        route,
        capturedAt: now,
        evidence: { submitCount },
      });
    }

    return out;
  }

  return {
    async signalsForUser({ tenantId, userId, windowMinutes }) {
      try {
        if (!tenantId || !userId) return [];
        const histogram = await source.countByTypeForUser({
          tenantId,
          userId,
          ...(windowMinutes ? { windowMinutes } : {}),
        });
        return deriveFromHistogram(histogram, '*');
      } catch {
        // Side-channel: never break the kernel turn on a sensorium miss.
        return [];
      }
    },

    async signalsForSession({
      tenantId,
      userId,
      sessionId,
      windowMinutes,
    }) {
      try {
        if (!tenantId || !userId || !sessionId) return [];
        const rows = await source.listForSession({
          tenantId,
          userId,
          sessionId,
          ...(windowMinutes ? { windowMinutes } : {}),
        });
        const histogram: Record<string, number> = {};
        let maxDwellMs = 0;
        let dwellRoute = '';
        const lastRoute = rows[0]?.route ?? '*';
        for (const row of rows) {
          histogram[row.eventType] = (histogram[row.eventType] ?? 0) + 1;
          if (row.eventType === 'dwell.time') {
            const dwellMs = Number(
              (row.payload as { dwellMs?: number }).dwellMs ?? 0,
            );
            if (dwellMs > maxDwellMs) {
              maxDwellMs = dwellMs;
              dwellRoute = row.route;
            }
          }
        }
        const out = deriveFromHistogram(histogram, lastRoute);
        if (maxDwellMs >= cfg.dwellDeepMs) {
          out.push({
            kind: 'dwell.deep',
            route: dwellRoute,
            capturedAt: new Date().toISOString(),
            evidence: { dwellMs: maxDwellMs },
          });
        }
        return out;
      } catch {
        return [];
      }
    },
  };
}
