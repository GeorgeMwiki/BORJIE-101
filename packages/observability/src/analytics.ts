/**
 * Unified analytics tracker.
 *
 * Prefers PostHog (self-hostable, EU-friendly) with lazy import so the package
 * stays slim when analytics is disabled.
 *
 * Canonical events:
 *   - chat.turn
 *   - chat.proposed_action_approved
 *   - workflow.completed
 *   - training.assigned
 *   - training.completed
 *   - mwikila.intervention_accepted
 *   - demo.played
 */

export type AnalyticsEventName =
  | 'chat.turn'
  | 'chat.proposed_action_approved'
  | 'workflow.completed'
  | 'training.assigned'
  | 'training.completed'
  | 'mwikila.intervention_accepted'
  | 'demo.played'
  | (string & { readonly __brand?: 'custom-event' });

export interface AnalyticsProperties {
  readonly tenantId?: string;
  readonly userId?: string;
  readonly sessionId?: string;
  readonly [key: string]: unknown;
}

export interface AnalyticsConfig {
  /** PostHog project API key (from POSTHOG_API_KEY env). Empty = disabled. */
  apiKey?: string;
  /** PostHog host (default https://eu.posthog.com) */
  host?: string;
  /** Service name emitting events */
  service: string;
  /** Runtime environment */
  environment?: string;
  /** PII scrubber applied to every string property before send */
  scrubber?: (input: string) => string;
}

export interface AnalyticsClient {
  track: (distinctId: string, event: AnalyticsEventName, properties?: AnalyticsProperties) => void;
  identify: (distinctId: string, traits?: AnalyticsProperties) => void;
  flush: () => Promise<void>;
  shutdown: () => Promise<void>;
  isEnabled: () => boolean;
}

const noopClient: AnalyticsClient = {
  track: () => {},
  identify: () => {},
  flush: async () => {},
  shutdown: async () => {},
  isEnabled: () => false,
};

let active: AnalyticsClient = noopClient;

function scrubProps(props: AnalyticsProperties | undefined, scrub?: (s: string) => string): Record<string, unknown> | undefined {
  if (!props) return undefined;
  if (!scrub) return { ...props };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    out[k] = typeof v === 'string' ? scrub(v) : v;
  }
  return out;
}

export async function initAnalytics(config: AnalyticsConfig): Promise<AnalyticsClient> {
  if (!config.apiKey) {
    active = noopClient;
    return active;
  }

  try {
    const mod = await import('posthog-node').catch(() => null);
    if (!mod || !mod.PostHog) {
      active = noopClient;
      return active;
    }
    const client = new mod.PostHog(config.apiKey, {
      host: config.host ?? 'https://eu.posthog.com',
      flushAt: 20,
      flushInterval: 10_000,
    });

    active = {
      track: (distinctId, event, properties) => {
        client.capture({
          distinctId,
          event,
          properties: {
            service: config.service,
            environment: config.environment ?? 'production',
            ...scrubProps(properties, config.scrubber),
          },
        });
      },
      identify: (distinctId, traits) => {
        client.identify({
          distinctId,
          properties: scrubProps(traits, config.scrubber),
        });
      },
      flush: async () => {
        await client.flush();
      },
      shutdown: async () => {
        await client.shutdown();
      },
      isEnabled: () => true,
    };
    return active;
  } catch {
    active = noopClient;
    return active;
  }
}

export function getAnalytics(): AnalyticsClient {
  return active;
}

/**
 * Shorthand for tracking a canonical event. Uses 'system' distinct-id when no
 * user id is available — callers should pass a tenant-scoped id when possible.
 */
export function trackEvent(
  event: AnalyticsEventName,
  properties: AnalyticsProperties = {},
): void {
  const distinctId =
    (properties.userId as string | undefined) ??
    (properties.tenantId as string | undefined) ??
    'system';
  active.track(distinctId, event, properties);
}
