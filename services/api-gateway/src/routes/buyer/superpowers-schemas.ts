/**
 * Zod schemas for the buyer-persona superpowers surface.
 *
 * The persona guard is duplicated here (mirrors the owner route's
 * BULK_WHITELIST superRefine) so the API stays defensible even if a
 * future caller bypasses buyer-mobile and hits the route directly. A
 * buyer may only ever request the two buyer verbs — `bulk_rfb` and
 * `bulk_watch`. Owner/manager verbs (snooze/complete/...) are rejected.
 */

import { z } from 'zod';

/** Entity types a buyer may pin / bookmark to their watchlist. */
export const BUYER_PIN_ENTITY_TYPES = [
  'parcel',
  'rfb',
  'contract',
  'offer',
] as const;
export type BuyerPinEntityType = (typeof BUYER_PIN_ENTITY_TYPES)[number];

/** The only bulk verbs the buyer persona is allowed to invoke. */
export const BUYER_BULK_ACTIONS = ['bulk_rfb', 'bulk_watch'] as const;
export type BuyerBulkAction = (typeof BUYER_BULK_ACTIONS)[number];

export const buyerBulkActionSchema = z.object({
  entityType: z.string().min(1).max(60),
  ids: z.array(z.string().min(1).max(120)).min(1).max(100),
  action: z.enum(BUYER_BULK_ACTIONS),
  persona: z.literal('buyer'),
  reason: z.string().min(1).max(400),
  payload: z.record(z.string(), z.unknown()).optional().default({}),
  provenance: z.record(z.string(), z.unknown()).optional().default({}),
});
export type BuyerBulkActionInput = z.infer<typeof buyerBulkActionSchema>;

export const buyerUndoLastSchema = z.object({
  journalIds: z.array(z.string().uuid()).min(1).max(100),
  reason: z.string().min(1).max(400).optional(),
});
export type BuyerUndoLastInput = z.infer<typeof buyerUndoLastSchema>;

export const buyerPinSchema = z.object({
  entityType: z.enum(BUYER_PIN_ENTITY_TYPES),
  entityId: z.string().min(1).max(120),
  label: z.string().min(1).max(80).optional(),
  persona: z.literal('buyer'),
  provenance: z.record(z.string(), z.unknown()).optional().default({}),
});
export type BuyerPinInput = z.infer<typeof buyerPinSchema>;

export const buyerSearchQuerySchema = z.object({
  q: z.string().min(1).max(200),
  persona: z.literal('buyer'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type BuyerSearchQueryInput = z.infer<typeof buyerSearchQuerySchema>;
