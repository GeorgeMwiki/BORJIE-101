/**
 * Agency — REAL action-tool adapters.
 *
 * Each factory wraps an `ActionToolDef` over an injected domain
 * service. When the underlying domain port is unavailable / unwired,
 * the adapter returns `{ ok: false, message: 'service not yet wired:
 * <details>' }` — it NEVER fakes a success. This honest-error path
 * keeps the kernel auditable: every tool either ran for real, or
 * surfaced a structured "not wired" message that the executor records.
 *
 * The five real factories cover the same five tools as the stubs:
 *   rent.send-reminder    → notifications port
 *   work-order.create     → work-orders port
 *   inspection.schedule   → inspections port
 *   arrears.escalate      → arrears port
 *   listing.publish       → marketplace port
 *
 * The composition root in services/api-gateway is responsible for
 * supplying real port instances when they exist; otherwise it leaves
 * them undefined and the adapter degrades gracefully. The original
 * stubs remain registered as the default fallback so the kernel can
 * always plan + execute end-to-end.
 *
 * Stake levels mirror the stubs: rent.send-reminder=low, work-order.
 * create=medium, inspection.schedule=medium, listing.publish=medium,
 * arrears.escalate=high. The autonomy-policy + four-eye gate apply
 * uniformly regardless of which adapter is registered.
 */
import type { ActionToolDef, ActionToolResult } from './types.js';

// ─────────────────────────────────────────────────────────────────────
// Domain service ports — duck-typed locally so this module does NOT
// compile-time-depend on the api-gateway domain services. Each port
// is intentionally narrow: only the shape the adapter calls.
//
// All ports are optional — when the composition root cannot wire a
// real port, the adapter returns the honest-error result.
// ─────────────────────────────────────────────────────────────────────

export interface NotificationsPortLike {
  sendRentReminder(args: {
    readonly tenantId: string;
    readonly leaseId: string;
    readonly channel: 'sms' | 'email';
  }): Promise<{ readonly id: string }>;
}

export interface WorkOrdersPortLike {
  create(args: {
    readonly tenantId: string;
    readonly propertyId: string;
    readonly unitId: string;
    readonly description: string;
    readonly priority: 'low' | 'medium' | 'high' | 'critical';
    readonly createdByUserId: string;
  }): Promise<{ readonly id: string }>;
}

export interface InspectionsPortLike {
  schedule(args: {
    readonly tenantId: string;
    readonly unitId: string;
    readonly scheduledFor: string;
    readonly inspectorId: string;
    readonly scheduledByUserId: string;
  }): Promise<{ readonly id: string }>;
}

export interface ArrearsPortLike {
  escalate(args: {
    readonly tenantId: string;
    readonly leaseId: string;
    readonly ladderStep: number;
    readonly escalatedByUserId: string;
  }): Promise<{ readonly id: string }>;
}

export interface MarketplacePortLike {
  publishListing(args: {
    readonly tenantId: string;
    readonly unitId: string;
    readonly headlineRent: number;
    readonly currency: string;
    readonly marketplaceId?: string;
    readonly publishedByUserId: string;
  }): Promise<{ readonly id: string }>;
}

export interface RealActionToolDeps {
  readonly notifications?: NotificationsPortLike;
  readonly workOrders?: WorkOrdersPortLike;
  readonly inspections?: InspectionsPortLike;
  readonly arrears?: ArrearsPortLike;
  readonly marketplace?: MarketplacePortLike;
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function notWired(detail: string): ActionToolResult<{ id: string }> {
  return {
    ok: false,
    message: `service not yet wired: ${detail}`,
  };
}

function safeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ─────────────────────────────────────────────────────────────────────
// Factories — one per tool. Each returns an `ActionToolDef` with the
// SAME `name` / `description` / `inputSchema` / `stakes` as the stub
// so registry overrides are drop-in.
// ─────────────────────────────────────────────────────────────────────

export function createRentSendReminderRealTool(
  deps: Pick<RealActionToolDeps, 'notifications'>,
): ActionToolDef<
  { leaseId: string; channel: 'sms' | 'email' },
  { id: string }
> {
  return {
    name: 'rent.send-reminder',
    description: 'Send a rent reminder to a lease via SMS or email.',
    stakes: 'low',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['leaseId', 'channel'],
      properties: {
        leaseId: { type: 'string' },
        channel: { type: 'string', enum: ['sms', 'email'] },
      },
    },
    async invoke(input, ctx) {
      if (!deps.notifications) {
        return notWired('notifications port unavailable for rent.send-reminder');
      }
      try {
        const out = await deps.notifications.sendRentReminder({
          tenantId: ctx.tenantId,
          leaseId: input.leaseId,
          channel: input.channel,
        });
        return { ok: true, output: { id: out.id } };
      } catch (err) {
        return { ok: false, message: `rent.send-reminder failed: ${safeError(err)}` };
      }
    },
  };
}

export function createWorkOrderCreateRealTool(
  deps: Pick<RealActionToolDeps, 'workOrders'>,
): ActionToolDef<
  {
    propertyId: string;
    unitId: string;
    description: string;
    priority: 'low' | 'medium' | 'high' | 'critical';
  },
  { id: string }
> {
  return {
    name: 'work-order.create',
    description: 'Create a maintenance work-order for a property/unit.',
    stakes: 'medium',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['propertyId', 'unitId', 'description', 'priority'],
      properties: {
        propertyId: { type: 'string' },
        unitId: { type: 'string' },
        description: { type: 'string' },
        priority: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'critical'],
        },
      },
    },
    async invoke(input, ctx) {
      if (!deps.workOrders) {
        return notWired('work-orders port unavailable for work-order.create');
      }
      try {
        const out = await deps.workOrders.create({
          tenantId: ctx.tenantId,
          propertyId: input.propertyId,
          unitId: input.unitId,
          description: input.description,
          priority: input.priority,
          createdByUserId: ctx.userId,
        });
        return { ok: true, output: { id: out.id } };
      } catch (err) {
        return { ok: false, message: `work-order.create failed: ${safeError(err)}` };
      }
    },
  };
}

export function createInspectionScheduleRealTool(
  deps: Pick<RealActionToolDeps, 'inspections'>,
): ActionToolDef<
  { unitId: string; scheduledFor: string; inspectorId: string },
  { id: string }
> {
  return {
    name: 'inspection.schedule',
    description: 'Schedule an inspection on a unit for a given inspector.',
    stakes: 'medium',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['unitId', 'scheduledFor', 'inspectorId'],
      properties: {
        unitId: { type: 'string' },
        scheduledFor: { type: 'string', format: 'date-time' },
        inspectorId: { type: 'string' },
      },
    },
    async invoke(input, ctx) {
      if (!deps.inspections) {
        return notWired('inspections port unavailable for inspection.schedule');
      }
      try {
        const out = await deps.inspections.schedule({
          tenantId: ctx.tenantId,
          unitId: input.unitId,
          scheduledFor: input.scheduledFor,
          inspectorId: input.inspectorId,
          scheduledByUserId: ctx.userId,
        });
        return { ok: true, output: { id: out.id } };
      } catch (err) {
        return { ok: false, message: `inspection.schedule failed: ${safeError(err)}` };
      }
    },
  };
}

export function createArrearsEscalateRealTool(
  deps: Pick<RealActionToolDeps, 'arrears'>,
): ActionToolDef<{ leaseId: string; ladderStep: number }, { id: string }> {
  return {
    name: 'arrears.escalate',
    description: 'Escalate an arrears case to the next ladder step.',
    stakes: 'high',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['leaseId', 'ladderStep'],
      properties: {
        leaseId: { type: 'string' },
        ladderStep: { type: 'integer', minimum: 0 },
      },
    },
    async invoke(input, ctx) {
      if (!deps.arrears) {
        return notWired('arrears port unavailable for arrears.escalate');
      }
      try {
        const out = await deps.arrears.escalate({
          tenantId: ctx.tenantId,
          leaseId: input.leaseId,
          ladderStep: input.ladderStep,
          escalatedByUserId: ctx.userId,
        });
        return { ok: true, output: { id: out.id } };
      } catch (err) {
        return { ok: false, message: `arrears.escalate failed: ${safeError(err)}` };
      }
    },
  };
}

export function createListingPublishRealTool(
  deps: Pick<RealActionToolDeps, 'marketplace'>,
): ActionToolDef<
  {
    unitId: string;
    headlineRent: number;
    currency: string;
    marketplaceId?: string;
  },
  { id: string }
> {
  return {
    name: 'listing.publish',
    description: 'Publish a vacancy listing for a unit to a marketplace.',
    stakes: 'medium',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['unitId', 'headlineRent', 'currency'],
      properties: {
        unitId: { type: 'string' },
        headlineRent: { type: 'number', minimum: 0 },
        currency: { type: 'string', minLength: 3, maxLength: 5 },
        marketplaceId: { type: 'string' },
      },
    },
    async invoke(input, ctx) {
      if (!deps.marketplace) {
        return notWired('marketplace port unavailable for listing.publish');
      }
      try {
        const out = await deps.marketplace.publishListing({
          tenantId: ctx.tenantId,
          unitId: input.unitId,
          headlineRent: input.headlineRent,
          currency: input.currency,
          ...(input.marketplaceId !== undefined
            ? { marketplaceId: input.marketplaceId }
            : {}),
          publishedByUserId: ctx.userId,
        });
        return { ok: true, output: { id: out.id } };
      } catch (err) {
        return { ok: false, message: `listing.publish failed: ${safeError(err)}` };
      }
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Bundled factory — composition roots can register the full set in
// one call. Returns the five `ActionToolDef`s in the same order as
// `DEFAULT_ACTION_TOOL_STUBS`. Tools with no port wired still
// register — they'll just return the honest-error result on invoke.
// ─────────────────────────────────────────────────────────────────────

export function createRealActionTools(
  deps: RealActionToolDeps,
): ReadonlyArray<ActionToolDef> {
  return [
    createRentSendReminderRealTool({
      ...(deps.notifications ? { notifications: deps.notifications } : {}),
    }),
    createWorkOrderCreateRealTool({
      ...(deps.workOrders ? { workOrders: deps.workOrders } : {}),
    }),
    createInspectionScheduleRealTool({
      ...(deps.inspections ? { inspections: deps.inspections } : {}),
    }),
    createArrearsEscalateRealTool({
      ...(deps.arrears ? { arrears: deps.arrears } : {}),
    }),
    createListingPublishRealTool({
      ...(deps.marketplace ? { marketplace: deps.marketplace } : {}),
    }),
  ];
}
