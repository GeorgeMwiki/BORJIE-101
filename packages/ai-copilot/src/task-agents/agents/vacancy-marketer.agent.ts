/**
 * vacancy_marketer_agent — fires when a unit status flips to 'vacant',
 * emitting a `marketplace.listing.publish` request event that the PhA1
 * vacancy pipeline subscribes to.
 *
 * We do NOT call the marketplace service directly here — PhA1 owns that
 * pipeline. Instead this agent emits a coordinating event (or calls a
 * provided port) so the split-agent contract is respected.
 */
import { z } from 'zod';
import type { TaskAgent, AgentRunResult } from '../types.js';

const PayloadSchema = z.object({
  unitId: z.string().min(1),
  propertyId: z.string().min(1),
  vacantSince: z.string().min(1),
  suggestedMonthlyRent: z.number().int().min(0).optional(),
});

export const vacancyMarketerAgent: TaskAgent<typeof PayloadSchema> = {
  id: 'vacancy_marketer_agent',
  title: 'Vacancy Marketer',
  description:
    'Auto-publishes a marketplace listing when a unit becomes vacant.',
  trigger: {
    kind: 'event',
    eventType: 'UnitStatusChangedToVacant',
    description: 'Fires when a unit status flips to vacant.',
  },
  guardrails: {
    autonomyDomain: 'leasing',
    autonomyAction: 'send_offer_letter',
    description:
      'Gated on leasing.autoSendOfferLetters-style policy (publish vs review).',
    invokesLLM: false,
  },
  payloadSchema: PayloadSchema,
  async execute(ctx): Promise<AgentRunResult> {
    const emitter = ctx.services.marketplacePublishRequester as
      | {
          requestListingPublish: (input: {
            tenantId: string;
            unitId: string;
            propertyId: string;
            vacantSince: string;
            suggestedMonthlyRent?: number;
            correlationId: string;
          }) => Promise<{ listingId: string } | null>;
        }
      | undefined;

    if (!emitter) {
      return {
        outcome: 'no_op',
        summary:
          'Marketplace publish requester not wired — PhA1 pipeline absent.',
        data: { reason: 'missing_deps', todo: 'wire PhA1 marketplacePublishRequester' },
        affected: [],
      };
    }

    try {
      const res = await emitter.requestListingPublish({
        tenantId: ctx.tenantId,
        unitId: ctx.payload.unitId,
        propertyId: ctx.payload.propertyId,
        vacantSince: ctx.payload.vacantSince,
        suggestedMonthlyRent: ctx.payload.suggestedMonthlyRent,
        correlationId: ctx.runId,
      });
      if (!res) {
        return {
          outcome: 'no_op',
          summary: 'PhA1 returned null (listing already exists).',
          data: {},
          affected: [{ kind: 'unit', id: ctx.payload.unitId }],
        };
      }
      return {
        outcome: 'executed',
        summary: `Requested marketplace listing publish for unit ${ctx.payload.unitId}.`,
        data: { listingId: res.listingId },
        affected: [
          { kind: 'unit', id: ctx.payload.unitId },
          { kind: 'marketplace_listing', id: res.listingId },
        ],
      };
    } catch (err) {
      return {
        outcome: 'error',
        summary: `Publish request failed: ${(err as Error).message}`,
        data: {},
        affected: [],
      };
    }
  },
};
