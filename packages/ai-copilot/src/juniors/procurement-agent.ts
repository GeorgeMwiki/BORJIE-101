/**
 * Procurement / Inventory Agent — reorder timeline, supplier ITC
 * compliance, days-remaining per item (AGENT_PROMPT_LIBRARY §12).
 *
 * Writes via typed `db.insert(procurementRecommendations)` (migration 0011).
 */

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  AuditedOutputBase,
  buildUniversalPrompt,
  defaultJuniorDeps,
  loadJuniorSchemas,
  runClaudeJunior,
  withResolvedDb,
  type JuniorDeps,
} from './_shared.js';

export const InventoryItem = z.object({
  item_id: z.string().min(1),
  name: z.string().min(1),
  category: z.string().min(1), // fuel, food, water, PPE, tools, parts, sample_bags, etc.
  unit: z.string().min(1),
  current_qty: z.number().nonnegative(),
  consumption_rate_per_day: z.number().nonnegative(),
  safety_buffer_days: z.number().int().nonnegative().default(2),
  preferred_supplier_id: z.string().optional(),
  supplier_lead_time_days: z.number().int().nonnegative().optional(),
  is_reserved_list_reg_13a: z.boolean().default(false),
  restricted: z.enum(['none', 'explosives', 'mercury']).default('none'),
});

export const SupplierSchema = z.object({
  supplier_id: z.string().min(1),
  name: z.string().min(1),
  tanzanian_equity_pct: z.number().min(0).max(100),
  is_itc: z.boolean(),
  brela_number: z.string().optional(),
});

export const ProcurementInputSchema = z.object({
  tenantId: z.string().min(1),
  siteId: z.string().min(1),
  items: z.array(InventoryItem).min(1),
  suppliers: z.array(SupplierSchema).default([]),
});
export type ProcurementInput = z.infer<typeof ProcurementInputSchema>;

export const ProcurementOutput = AuditedOutputBase.extend({
  reorder_timeline: z.array(
    z.object({
      item_id: z.string(),
      days_remaining: z.number(),
      alert_level: z.enum(['green', 'amber', 'red']),
      recommended_order_qty: z.number().nonnegative(),
      recommended_supplier_id: z.string().nullable(),
      reason: z.string(),
    }),
  ),
  supplier_compliance: z.array(
    z.object({
      supplier_id: z.string(),
      ok_for_reserved_list: z.boolean(),
      ok_for_non_reserved: z.boolean(),
      jv_equity_pct: z.number(),
      notes: z.string(),
    }),
  ),
  sole_source_notifications: z.array(z.object({ item_id: z.string(), supplier_id: z.string(), amount_usd: z.number() })),
});
export type ProcurementOutput = z.infer<typeof ProcurementOutput>;

export const PROCUREMENT_SYSTEM_PROMPT = buildUniversalPrompt({
  juniorName: 'Procurement / Inventory Agent',
  mandate:
    'Prevent stock-outs and over-stocks; recommend reorders sized by Wilson EOQ light; enforce Local Content Reg 13A reserved-list rules.',
  tools:
    'list_inventory, forecast_stockout, recommend_reorder, list_suppliers, beneficial_ownership_check, notify_commission_sole_source.',
  evidence:
    'Cite consumption_rate + lead_time + safety_buffer for every days_remaining call. ' +
    'Cite Mining (Local Content) Regulations 2018 + GN 563/2025 Reg 13A for supplier compliance.',
  outputSchema:
    '{ "reorder_timeline": [...], "supplier_compliance": [...], "sole_source_notifications": [...], ' +
    '"confidence": number, "rationale": string, "evidence_ids": string[], "citations": string[] }',
  confidenceFloor: 0.7,
  autonomyDomain: 'recommendations only — never raises a PO without owner approval',
  hardRules: [
    'For Reg 13A reserved-list goods/services: require 100 % Tanzanian-owned ITC supplier.',
    'For non-reserved with non-indigenous supplier: require ≥ 20 % ITC JV equity.',
    'Sole-source > USD 10 000: emit notify_commission_sole_source entry.',
    'For restricted items (explosives, mercury): only track lawful permit status; never advise procurement.',
  ],
});

function buildUserPrompt(input: ProcurementInput): string {
  return [
    `TENANT: ${input.tenantId}  SITE: ${input.siteId}`,
    `ITEMS (${input.items.length}):`,
    JSON.stringify(input.items, null, 2).slice(0, 3_500),
    `SUPPLIERS (${input.suppliers.length}):`,
    JSON.stringify(input.suppliers, null, 2).slice(0, 2_500),
  ].join('\n');
}

export function createProcurementAgent(deps: JuniorDeps) {
  return {
    async processInput(input: ProcurementInput): Promise<ProcurementOutput> {
      const validated = ProcurementInputSchema.parse(input);
      const output = await runClaudeJunior({
        claude: deps.claude,
        logger: deps.logger,
        juniorName: 'procurement-agent',
        schema: ProcurementOutput,
        systemPrompt: PROCUREMENT_SYSTEM_PROMPT,
        userPrompt: buildUserPrompt(validated),
        maxTokens: 2500,
      });

      if (deps.db) {
        try {
          const schemas = await loadJuniorSchemas();
          const procurementRecommendations = schemas?.procurementRecommendations as unknown;
          if (procurementRecommendations) {
            await deps.db
              .insert(procurementRecommendations)
              .values({
                id: randomUUID(),
                tenantId: validated.tenantId,
                siteId: validated.siteId,
                summary: output,
              })
              .onConflictDoNothing();
          }
        } catch (err) {
          deps.logger?.warn('procurement-agent: db write skipped', { error: err instanceof Error ? err.message : String(err) });
        }
      }
      return output;
    },
  };
}
export type ProcurementAgent = ReturnType<typeof createProcurementAgent>;

export function createDefaultProcurementAgent(): ProcurementAgent {
  let cached: ProcurementAgent | null = null;
  const get = async () => {
    if (cached) return cached;
    const deps = await withResolvedDb(defaultJuniorDeps());
    cached = createProcurementAgent(deps);
    return cached;
  };
  return {
    async processInput(input) {
      return (await get()).processInput(input);
    },
  };
}
