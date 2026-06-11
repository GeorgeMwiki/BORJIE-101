/**
 * Audience fan-out (surface-completion SC-6) — the (scope, audience) → N
 * per-recipient expander the notification path admitted was missing
 * (notification-dispatcher-adapter.ts: "that pipeline expands a
 * (scope, audience) pair into N rows and is owned by a separate worker").
 *
 * THE MODEL: the cross-portal bus had only TWO topic granularities —
 * tenant-wide and global. The completion cascade needs CLASSIFIED
 * granularity ("only those who are needed"): a per-IDENTITY topic every
 * mobile/web session of one human can subscribe to, and a per-AUDIENCE
 * topic for a role-class within an org. The classifier resolves through
 * the MEMBERSHIP GRAPH (org_memberships via resolveAudience) — which
 * buyers / which workforce role-class, ACTIVE only — so the audience is
 * always permission-true at publish time.
 *
 * LIVE CONSUMER (not born-dark): the pairing surface fans its lifecycle
 * through this — a new request notifies the org's admin audience; an
 * approve/reject/revoke notifies the affected member's identity topic in
 * realtime. The CapabilitySpec binder (the wider surface-completion
 * engine) composes onto these same topics.
 *
 * Every publish is best-effort + logged: the DB row (membership /
 * announcement / tab) is always the source of truth; realtime is a
 * delivery accelerant, never a dependency.
 */

import type { CrossPortalBus } from './cross-portal-bus.js';

// ---------------------------------------------------------------------------
// Topic builders (sanitized exactly like tenantTopic)
// ---------------------------------------------------------------------------

function sanitize(part: string, label: string): string {
  if (!part || typeof part !== 'string') {
    throw new Error(`${label}: value required`);
  }
  const safe = part.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe) {
    throw new Error(`${label}: value reduced to empty after sanitisation`);
  }
  return safe;
}

/** One human's realtime channel — every session of that identity listens. */
export function identityTopic(tenantIdentityId: string): string {
  return `borjie:cross-portal:identity:${sanitize(
    tenantIdentityId,
    'identityTopic',
  )}:event`;
}

/** A classified audience within an org (role-class / relationship-class). */
export function audienceTopic(
  organizationId: string,
  audienceKey: string,
): string {
  return (
    'borjie:cross-portal:org:' +
    sanitize(organizationId, 'audienceTopic.organizationId') +
    ':audience:' +
    sanitize(audienceKey, 'audienceTopic.audienceKey') +
    ':event'
  );
}

// ---------------------------------------------------------------------------
// The fan-out organ
// ---------------------------------------------------------------------------

/** The audience classifier — predicates over the membership graph. */
export interface AudienceSelector {
  readonly relationshipType?:
    | 'employment'
    | 'buyer_connection'
    | 'contractor'
    | 'guest';
  readonly memberRoles?: ReadonlyArray<string>;
}

/** Structural membership-resolver port (the repo's resolveAudience shape). */
export interface AudienceMembershipResolver {
  resolveAudience(
    organizationId: string,
    query?: AudienceSelector,
  ): Promise<ReadonlyArray<{ readonly tenantIdentityId: string }>>;
}

export interface AudienceFanoutLogger {
  readonly warn?: (meta: Record<string, unknown>, msg: string) => void;
}

export interface PublishToAudienceArgs {
  readonly organizationId: string;
  readonly audience: AudienceSelector;
  readonly kind: 'notification' | 'state-mutation' | 'wake-trigger';
  readonly payload: Record<string, unknown>;
  readonly emittedBy: string;
}

export interface PublishToIdentityArgs {
  readonly tenantIdentityId: string;
  readonly kind: 'notification' | 'state-mutation' | 'wake-trigger';
  readonly payload: Record<string, unknown>;
  readonly emittedBy: string;
}

export interface AudienceFanout {
  /** Classified fan: resolve the audience → one publish per recipient
   *  identity + one on the audience summary topic. Returns the recipient
   *  count (0 on resolution failure — best-effort). */
  publishToAudience(args: PublishToAudienceArgs): Promise<number>;
  /** Single-recipient leg (decision notices, direct handoffs). */
  publishToIdentity(args: PublishToIdentityArgs): Promise<void>;
}

export interface CreateAudienceFanoutDeps {
  readonly membershipResolver: AudienceMembershipResolver;
  /** Resolved lazily + cached — mirrors notification-dispatcher-adapter. */
  readonly crossPortalBus: Promise<CrossPortalBus>;
  readonly logger?: AudienceFanoutLogger;
  readonly clock?: () => Date;
}

function audienceKeyOf(audience: AudienceSelector): string {
  if (audience.relationshipType) return `rel-${audience.relationshipType}`;
  if (audience.memberRoles && audience.memberRoles.length > 0) {
    return `role-${[...audience.memberRoles].sort().join('-')}`;
  }
  return 'all';
}

export function createAudienceFanout(
  deps: CreateAudienceFanoutDeps,
): AudienceFanout {
  const clock = deps.clock ?? (() => new Date());
  let busPromise: Promise<CrossPortalBus | null> | null = null;
  function resolveBusOnce(): Promise<CrossPortalBus | null> {
    if (busPromise) return busPromise;
    busPromise = deps.crossPortalBus.catch((err: unknown) => {
      deps.logger?.warn?.(
        {
          err: err instanceof Error ? err.message : String(err),
          wiring: 'audience-fanout',
        },
        'audience-fanout: bus resolution failed — realtime fan disabled',
      );
      return null;
    });
    return busPromise;
  }

  async function publishOne(
    topic: string,
    kind: PublishToAudienceArgs['kind'],
    payload: Record<string, unknown>,
    emittedBy: string,
  ): Promise<void> {
    const bus = await resolveBusOnce();
    if (!bus) return;
    try {
      await bus.publish(topic, {
        kind,
        payload,
        emittedBy,
        emittedAt: clock().toISOString(),
      });
    } catch (err) {
      deps.logger?.warn?.(
        {
          err: err instanceof Error ? err.message : String(err),
          topic,
          wiring: 'audience-fanout',
        },
        'audience-fanout: publish failed (DB row remains source of truth)',
      );
    }
  }

  return {
    async publishToAudience(args) {
      let recipients: ReadonlyArray<{ tenantIdentityId: string }> = [];
      try {
        recipients = await deps.membershipResolver.resolveAudience(
          args.organizationId,
          args.audience,
        );
      } catch (err) {
        deps.logger?.warn?.(
          {
            err: err instanceof Error ? err.message : String(err),
            organizationId: args.organizationId,
            wiring: 'audience-fanout',
          },
          'audience-fanout: audience resolution failed — 0 recipients',
        );
        return 0;
      }
      const seen = new Set<string>();
      await Promise.all(
        recipients
          .filter((r) => {
            if (seen.has(r.tenantIdentityId)) return false;
            seen.add(r.tenantIdentityId);
            return true;
          })
          .map((r) =>
            publishOne(
              identityTopic(r.tenantIdentityId),
              args.kind,
              args.payload,
              args.emittedBy,
            ),
          ),
      );
      await publishOne(
        audienceTopic(args.organizationId, audienceKeyOf(args.audience)),
        args.kind,
        args.payload,
        args.emittedBy,
      );
      return seen.size;
    },

    async publishToIdentity(args) {
      await publishOne(
        identityTopic(args.tenantIdentityId),
        args.kind,
        args.payload,
        args.emittedBy,
      );
    },
  };
}
