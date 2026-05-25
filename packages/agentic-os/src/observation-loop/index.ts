/**
 * observation-loop — every state change emits an Observation; agents can
 * subscribe to their own observations for reflection; reflection feeds
 * back into trust calibration + capability ratings.
 *
 * Pattern: Reflexion (Shinn et al. 2023) + Voyager skill-promotion (Wang
 * 2023) + Sutton & Barto reward shaping. Reflection is brain-driven so
 * the summary is human-readable + auditable.
 */

import type {
  BrainPort,
  Observation,
  ObservationStorePort,
  ReflectionUpdate,
} from '../types.js';

// ============================================================================
// In-memory observation store + subscriber registry
// ============================================================================

export type ObservationHandler = (
  observation: Observation,
) => void | Promise<void>;

export interface ObservationLoop extends ObservationStorePort {
  /** Subscribe an agent to observations targeting that agent. */
  subscribeAgent(args: {
    readonly agentId: string;
    readonly handler: ObservationHandler;
  }): { readonly unsubscribe: () => void };
  /** Subscribe to ALL observations (e.g. for audit / dashboard sinks). */
  subscribeAll(handler: ObservationHandler): { readonly unsubscribe: () => void };
}

interface AgentSubscriber {
  readonly agentId: string;
  readonly handler: ObservationHandler;
}

export function createObservationLoop(): ObservationLoop {
  const log: Observation[] = [];
  const agentSubscribers: AgentSubscriber[] = [];
  const globalSubscribers: ObservationHandler[] = [];

  return {
    async emit(observation) {
      log.push(observation);
      // Notify global subscribers first (audit + dashboards)
      for (const h of globalSubscribers) {
        try {
          await h(observation);
        } catch {
          // swallow — observability MUST NOT crash the runtime
        }
      }
      // Then notify agent-specific subscribers
      if (observation.agentId) {
        for (const s of agentSubscribers) {
          if (s.agentId === observation.agentId) {
            try {
              await s.handler(observation);
            } catch {
              // swallow
            }
          }
        }
      }
    },
    async list(args) {
      return log.filter((o) => {
        if (args.agentId && o.agentId !== args.agentId) return false;
        if (args.tenantId && o.tenantId !== args.tenantId) return false;
        if (args.goalId && o.goalId !== args.goalId) return false;
        if (args.sinceIso && o.at < args.sinceIso) return false;
        if (args.untilIso && o.at > args.untilIso) return false;
        return true;
      });
    },
    subscribeAgent({ agentId, handler }) {
      const sub: AgentSubscriber = { agentId, handler };
      agentSubscribers.push(sub);
      return {
        unsubscribe() {
          const idx = agentSubscribers.indexOf(sub);
          if (idx >= 0) agentSubscribers.splice(idx, 1);
        },
      };
    },
    subscribeAll(handler) {
      globalSubscribers.push(handler);
      return {
        unsubscribe() {
          const idx = globalSubscribers.indexOf(handler);
          if (idx >= 0) globalSubscribers.splice(idx, 1);
        },
      };
    },
  };
}

// ============================================================================
// reflectOnPeriod — agent self-reflection over a window
// ============================================================================

export interface ReflectArgs {
  readonly agentId: string;
  readonly observations: ObservationStorePort;
  readonly brain: BrainPort;
  /** Window start ISO timestamp. */
  readonly sinceIso: string;
  /** Window end ISO timestamp. Default: now. */
  readonly untilIso?: string;
}

export async function reflectOnPeriod(
  args: ReflectArgs,
): Promise<ReflectionUpdate> {
  const untilIso = args.untilIso ?? new Date().toISOString();
  const baseArgs: Parameters<ObservationStorePort['list']>[0] = {
    agentId: args.agentId,
    sinceIso: args.sinceIso,
    untilIso,
  };
  const observations = await args.observations.list(baseArgs);
  return await args.brain.reflect({
    agentId: args.agentId,
    observations,
  });
}
