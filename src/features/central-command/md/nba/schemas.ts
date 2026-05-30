/**
 * Zod schemas for external inputs into the NBA service.
 *
 * Keeps `BusinessSnapshot` shape validatable at the API boundary without
 * leaking Zod into pure scorer modules.
 *
 * @module features/central-command/md/nba/schemas
 */

import { z } from "zod";

export const customerSignalSchema = z.object({
  customerId: z.string().min(1),
  name: z.string().min(1),
  npsScore: z.number().min(0).max(10).optional(),
  csatScore: z.number().min(0).max(5).optional(),
  lastContactDaysAgo: z.number().int().min(0),
  openComplaints: z.number().int().min(0),
  arrUsd: z.number().min(0).optional(),
});

export const employeeSignalSchema = z.object({
  employeeId: z.string().min(1),
  name: z.string().min(1),
  daysSinceLast1on1: z.number().int().min(0),
  engagementScore: z.number().min(0).max(10).optional(),
  isNewHire: z.boolean(),
  daysInRole: z.number().int().min(0),
});

export const pipelineSignalSchema = z.object({
  leadId: z.string().min(1),
  stage: z.string().min(1),
  daysInStage: z.number().int().min(0),
  valueUsd: z.number().min(0),
  probability: z.number().min(0).max(1),
});

export const supplierSignalSchema = z.object({
  supplierId: z.string().min(1),
  name: z.string().min(1),
  contractExpiresInDays: z.number().int(),
  criticality: z.enum(["low", "medium", "high"]),
  annualSpendUsd: z.number().min(0),
});

export const financeSignalSchema = z.object({
  cashUsd: z.number().min(0),
  monthlyBurnUsd: z.number().min(0),
  overdueInvoicesCount: z.number().int().min(0),
  overdueAmountUsd: z.number().min(0),
});

export const complianceSignalSchema = z.object({
  obligationId: z.string().min(1),
  description: z.string().min(1),
  dueInDays: z.number().int(),
  status: z.enum(["open", "in-progress", "submitted"]),
});

export const learningSignalSchema = z.object({
  employeeId: z.string().min(1),
  trackName: z.string().min(1),
  completionPercent: z.number().min(0).max(100),
});

export const ownerSentimentSchema = z.object({
  score: z.number().min(-1).max(1),
  recentTopics: z.array(z.string()),
});

export const ownerStyleSchema = z.object({
  preferredMode: z.enum([
    "bias-to-action",
    "deliberate",
    "data-driven",
    "people-first",
  ]),
  easeBias: z.number().min(0).max(1),
  impactBias: z.number().min(0).max(1),
});

export const businessSnapshotSchema = z.object({
  orgId: z.string().min(1),
  generatedAt: z.string().min(1),
  customers: z.array(customerSignalSchema),
  employees: z.array(employeeSignalSchema),
  pipeline: z.array(pipelineSignalSchema),
  suppliers: z.array(supplierSignalSchema),
  finance: financeSignalSchema,
  compliance: z.array(complianceSignalSchema),
  learning: z.array(learningSignalSchema),
  ownerSentiment: ownerSentimentSchema.optional(),
  ownerStyle: ownerStyleSchema.optional(),
});

export type BusinessSnapshotInput = z.infer<typeof businessSnapshotSchema>;
