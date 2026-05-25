/**
 * Agency — STUB action-tool definitions.
 *
 * Five typed stub tools the brain can invoke autonomously. Each ships
 * with a real input JSON schema + stakes classification but the
 * `invoke` body is a no-op that returns a synthetic id. Composition
 * roots replace these with real domain-service adapters; until then,
 * the kernel can plan + execute end-to-end against the stubs.
 */
import { randomUUID } from 'crypto';
import type { ActionToolDef } from './types.js';

const okStubId = (): { readonly id: string } => ({ id: `stub_${randomUUID()}` });

export const RENT_SEND_REMINDER_TOOL: ActionToolDef<
  { leaseId: string; channel: 'sms' | 'email' },
  { id: string }
> = {
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
  async invoke() {
    return { ok: true, output: okStubId() };
  },
};

export const WORK_ORDER_CREATE_TOOL: ActionToolDef<
  {
    propertyId: string;
    unitId: string;
    description: string;
    priority: 'low' | 'medium' | 'high' | 'critical';
  },
  { id: string }
> = {
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
  async invoke() {
    return { ok: true, output: okStubId() };
  },
};

export const INSPECTION_SCHEDULE_TOOL: ActionToolDef<
  { unitId: string; scheduledFor: string; inspectorId: string },
  { id: string }
> = {
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
  async invoke() {
    return { ok: true, output: okStubId() };
  },
};

export const ARREARS_ESCALATE_TOOL: ActionToolDef<
  { leaseId: string; ladderStep: number },
  { id: string }
> = {
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
  async invoke() {
    return { ok: true, output: okStubId() };
  },
};

export const LISTING_PUBLISH_TOOL: ActionToolDef<
  {
    unitId: string;
    headlineRent: number;
    currency: string;
    marketplaceId?: string;
  },
  { id: string }
> = {
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
  async invoke() {
    return { ok: true, output: okStubId() };
  },
};

export const DEFAULT_ACTION_TOOL_STUBS: ReadonlyArray<ActionToolDef> = [
  RENT_SEND_REMINDER_TOOL,
  WORK_ORDER_CREATE_TOOL,
  INSPECTION_SCHEDULE_TOOL,
  ARREARS_ESCALATE_TOOL,
  LISTING_PUBLISH_TOOL,
];
