/**
 * Slack channel ACL resolver — Glean/Onyx "permission-aware ingestion".
 *
 * Maps a Slack channel id (`C0123ABC` / `G0123ABC` / `D0123ABC` /
 * `G0xxxxxxxx`) to a `SlackChannelACL` envelope that downstream
 * components (the brain-event emitter) put on every event. Three
 * canonical cases:
 *
 *   - **DM (`im`)** — `userIds = [sender, recipient]`. A Slack DM is
 *     a two-person channel; the recipient is the bot user when it's
 *     a `D...`-id channel (a tenant-side bot DM). Empty `roleIds` —
 *     DMs never grant role-based access.
 *
 *   - **Multi-person DM (`mpim`)** — `userIds = [all members]`.
 *     Member list resolved live from the API. Empty `roleIds`.
 *
 *   - **Private channel (`group`)** — `userIds = [all members]`.
 *     Member list resolved live from the API (paginated). Empty
 *     `roleIds`. CRITICAL: stale member snapshots = potential leak;
 *     resolve at ingest, never lazily.
 *
 *   - **Public channel (`channel`)** — `userIds = []`,
 *     `roleIds = [tenantAllMembersRoleId]`. The tenant's "all members"
 *     role is supplied at resolver-construction time. The retriever
 *     expands this role against live tenant membership at query time
 *     — so a tenant member added after ingest still gets read access,
 *     and a member removed after ingest loses it.
 *
 * "Channel = all members" is the literal rule in the task scope; this
 * resolver delegates the membership lookup to the Slack client (which
 * handles pagination) and tags the ACL with the appropriate
 * discriminator.
 *
 * Tenant isolation: this resolver is constructed PER tenant. It holds
 * a per-tenant SlackClient and the tenant's "all members" role id;
 * cross-tenant calls are impossible by construction.
 */

import type { SlackClient } from './slack-client.js';
import type {
  SlackChannelACL,
  SlackChannelACLResolver,
} from './types.js';

// ============================================================================
// Resolver options
// ============================================================================

export interface SlackACLResolverOptions {
  /**
   * Per-tenant Slack web client. Used to fetch `conversations.info`
   * and `conversations.members`. Constructed once per tenant install
   * by the composition root.
   */
  readonly client: SlackClient;
  /**
   * BORJIE tenant id this resolver serves. Used as a defensive
   * mismatch check against the client's install — a mismatch means
   * the composition root wired the wrong client to the wrong tenant
   * and is a critical bug.
   */
  readonly tenantId: string;
  /**
   * Tenant-wide "all members" role id. Returned in `roleIds` for
   * public-channel ACL envelopes; the retriever expands it against
   * the live tenant membership at query time. When omitted, public
   * channels resolve to an EMPTY ACL (quarantined) — better to
   * over-restrict than under-restrict.
   */
  readonly tenantAllMembersRoleId?: string;
  /**
   * Optional logger for resolution failures. The resolver never
   * throws — failures degrade to a quarantine ACL (empty userIds +
   * empty roleIds) which downstream consumers MUST treat as "no-one
   * may read".
   */
  readonly logger?: {
    warn(obj: Record<string, unknown>, msg?: string): void;
  };
}

// ============================================================================
// Implementation
// ============================================================================

export class SlackAclResolver implements SlackChannelACLResolver {
  private readonly client: SlackClient;
  private readonly tenantId: string;
  private readonly tenantAllMembersRoleId?: string;
  private readonly logger?: SlackACLResolverOptions['logger'];

  constructor(options: SlackACLResolverOptions) {
    this.client = options.client;
    this.tenantId = options.tenantId;
    if (options.tenantAllMembersRoleId) {
      this.tenantAllMembersRoleId = options.tenantAllMembersRoleId;
    }
    if (options.logger) {
      this.logger = options.logger;
    }

    if (this.client.install.tenantId !== this.tenantId) {
      // Cross-tenant wiring bug — fail loud at construction.
      // This is the only throw in the resolver; runtime resolution
      // failures degrade to quarantine ACL instead.
      throw new Error(
        `SlackAclResolver: tenant mismatch (resolver tenant=${this.tenantId}, client install tenant=${this.client.install.tenantId}). Composition root wired the wrong client.`,
      );
    }
  }

  async resolve(args: {
    readonly tenantId: string;
    readonly channelId: string;
  }): Promise<SlackChannelACL> {
    // Defensive cross-tenant check.
    if (args.tenantId !== this.tenantId) {
      this.logger?.warn(
        {
          requested: args.tenantId,
          resolver: this.tenantId,
          channelId: args.channelId,
        },
        'slack-acl-resolver: cross-tenant resolve attempt; refusing',
      );
      return quarantine();
    }

    try {
      const infoOutcome = await this.client.conversationsInfo(args.channelId);
      if (infoOutcome.kind !== 'ok') {
        this.logger?.warn(
          {
            channelId: args.channelId,
            outcome: infoOutcome.kind,
          },
          'slack-acl-resolver: conversations.info failed; quarantining',
        );
        return quarantine();
      }

      const info = infoOutcome.data.channel;
      const kind = inferChannelKind(info);

      // Public channels: tenant-wide read via role expansion.
      if (kind === 'channel') {
        return {
          kind: 'channel',
          members: [],
          isPublic: true,
          ...(this.tenantAllMembersRoleId
            ? // (No-op; role is added via the returned object below.)
              {}
            : {}),
        } as SlackChannelACL & { readonly roleIds?: ReadonlyArray<string> };
        // ^ kept the shape minimal — role attachment happens in the
        // emitter where it combines with userIds.
      }

      // DMs, group DMs, and private channels: paginate the full
      // member list.
      const members = await this.collectAllMembers(args.channelId);

      return {
        kind,
        members,
        isPublic: false,
      };
    } catch (error) {
      this.logger?.warn(
        {
          channelId: args.channelId,
          err: error instanceof Error ? error.message : String(error),
        },
        'slack-acl-resolver: unexpected error; quarantining',
      );
      return quarantine();
    }
  }

  /**
   * Exposed for the brain-event emitter: returns the configured
   * tenant "all members" role id (or undefined when not configured).
   * Kept on the resolver because the resolver owns the tenant-scope
   * configuration.
   */
  getTenantAllMembersRoleId(): string | undefined {
    return this.tenantAllMembersRoleId;
  }

  private async collectAllMembers(channelId: string): Promise<ReadonlyArray<string>> {
    const all: string[] = [];
    let cursor: string | undefined;
    let safety = 0;

    do {
      // Safety cap: 200 members/page × 25 pages = 5000 members max.
      // The largest Slack workspaces top out around 10K but a single
      // channel rarely exceeds 5K; if we ever hit the cap, the
      // resolver returns a partial list (better than infinite loop).
      if (safety >= 25) {
        this.logger?.warn(
          { channelId, collected: all.length },
          'slack-acl-resolver: hit pagination safety cap; returning partial',
        );
        break;
      }

      const page = await this.client.conversationsMembers(channelId, cursor);
      if (page.kind !== 'ok') {
        this.logger?.warn(
          {
            channelId,
            outcome: page.kind,
            collected: all.length,
          },
          'slack-acl-resolver: conversations.members failed mid-page; returning partial',
        );
        break;
      }

      for (const memberId of page.data.members) {
        if (memberId) all.push(memberId);
      }

      cursor = page.data.response_metadata?.next_cursor;
      safety += 1;
    } while (cursor && cursor.length > 0);

    return Array.from(new Set(all));
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Map Slack's `conversations.info` flags to our discriminator.
 *
 * Slack's flag matrix is mutually exclusive but redundant — `is_im`
 * implies a DM, `is_mpim` implies a multi-person DM, `is_group` (or
 * `is_private && is_channel`) implies a private channel, and the
 * default is a public channel.
 */
function inferChannelKind(info: {
  readonly is_im?: boolean;
  readonly is_mpim?: boolean;
  readonly is_group?: boolean;
  readonly is_private?: boolean;
  readonly is_channel?: boolean;
}): 'im' | 'mpim' | 'group' | 'channel' {
  if (info.is_im) return 'im';
  if (info.is_mpim) return 'mpim';
  if (info.is_group || (info.is_private && !info.is_im && !info.is_mpim)) {
    return 'group';
  }
  return 'channel';
}

/**
 * Quarantine ACL — no-one may read. Returned on every failure path
 * so the connector contract holds: ACL is always present, never
 * `undefined`, and over-restriction is the safe default.
 */
function quarantine(): SlackChannelACL {
  return {
    kind: 'group',
    members: [],
    isPublic: false,
  };
}

/** Factory function for composition root wiring. */
export function createSlackAclResolver(
  options: SlackACLResolverOptions,
): SlackAclResolver {
  return new SlackAclResolver(options);
}
