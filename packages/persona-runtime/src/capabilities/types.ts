/**
 * Capability registry — disclosure-safe types.
 *
 * Single source of truth for what Borjie / Mr. Mwikila CAN do, expressed as
 * USER OUTCOMES (never internal mechanics). Every chat surface (public-chat,
 * brain-teach, voice, push, email) reads from this registry when the owner
 * asks "what can you do" / "how does this work" / "are you AI".
 *
 * Disclosure discipline (CSA-1):
 *   - PUBLIC          — safe to mention freely; outcome-only language.
 *   - INTERNAL        — describe outcome only, NEVER mention mechanics
 *                       (no service names, no agent counts, no tool ids).
 *   - EXPERIMENTAL    — "we're exploring this — want early access?"
 *
 * Bilingual (sw is default for the owner persona; en is the fallback).
 */

import { z } from 'zod';

export const CAPABILITY_VISIBILITY = [
  'PUBLIC',
  'INTERNAL',
  'EXPERIMENTAL',
] as const;
export type CapabilityVisibility = (typeof CAPABILITY_VISIBILITY)[number];

export const CAPABILITY_TOPIC = [
  'drafting',
  'tracking',
  'alerting',
  'forecasting',
  'communicating',
  'searching',
  'compliance',
  'marketplace',
  'hr',
  'safety',
  'decision-making',
  'memory',
  'multi-device',
  'multi-language',
  'multi-currency',
  'multi-scale',
  'meta',
] as const;
export type CapabilityTopic = (typeof CAPABILITY_TOPIC)[number];

const BilingualStringSchema = z
  .object({
    en: z.string().min(1).max(400),
    sw: z.string().min(1).max(400),
  })
  .strict();
export type BilingualString = z.infer<typeof BilingualStringSchema>;

export const CapabilityEntrySchema = z
  .object({
    id: z
      .string()
      .min(3)
      .max(120)
      .regex(/^[a-z0-9][a-z0-9._-]*$/i, 'lowercase + dots/dashes/underscores'),
    topic: z.enum(CAPABILITY_TOPIC),
    user_outcome: z.string().min(1).max(280),
    public_name: BilingualStringSchema,
    public_description: BilingualStringSchema,
    example_question: BilingualStringSchema,
    example_response_pattern: BilingualStringSchema,
    related: z.array(z.string().min(3).max(120)).max(8),
    visibility: z.enum(CAPABILITY_VISIBILITY),
  })
  .strict();
export type CapabilityEntry = z.infer<typeof CapabilityEntrySchema>;

/**
 * Pure filter — only PUBLIC + EXPERIMENTAL entries are returned for
 * narrative disclosure. INTERNAL entries are kept in the registry for
 * the brain's own routing logic but never quoted to the owner.
 */
export const isDisclosable = (entry: CapabilityEntry): boolean =>
  entry.visibility === 'PUBLIC' || entry.visibility === 'EXPERIMENTAL';

/**
 * Hard-fail validation entry-point — used by registry boot to ensure no
 * malformed entry survives a typo / missing translation.
 */
export const parseCapabilityEntry = (raw: unknown): CapabilityEntry =>
  CapabilityEntrySchema.parse(raw);
