/**
 * Requisitions service — draft → submit → approve → convert (RFQ or PO).
 *
 * Submitting a requisition kicks off an `ApprovalChain` and reserves
 * funds against the matching budget (if any). Approval / rejection
 * flows through the `ApprovalEnginePort`; once approved the requester
 * (or buyer) can convert the requisition into either an RFQ (multi-bid)
 * or a single-vendor PO (fast path).
 *
 * Every mutation returns a NEW record. The budget reservation is
 * released on rejection / cancellation so funds re-enter the
 * `available` pool immediately.
 */

import { z } from 'zod';
import type {
  ApprovalEnginePort,
  Budget,
  ClockPort,
  CurrencyCode,
  ProcurementDataPort,
  Requisition,
  RequisitionId,
  RequisitionItem,
  VendorCategory,
} from '../types.js';
import { SYSTEM_CLOCK } from '../types.js';

const RequisitionItemSchema = z.object({
  sku: z.string().nullable().optional(),
  description: z.string().min(1).max(500),
  qty: z.number().positive(),
  unit: z.string().min(1).max(20),
  estimatedUnitPrice: z.number().nonnegative(),
  currency: z.string().length(3),
});

const CreateRequisitionSchema = z.object({
  tenantId: z.string().min(1),
  requestedBy: z.string().min(1),
  department: z.string().nullable().optional(),
  propertyId: z.string().nullable().optional(),
  items: z.array(RequisitionItemSchema).min(1),
  justification: z.string().min(10).max(2000),
  urgency: z.enum(['low', 'normal', 'high', 'emergency']).default('normal'),
  budgetId: z.string().nullable().optional(),
  category: z.string().optional(),
});

export type CreateRequisitionInput = z.input<typeof CreateRequisitionSchema>;

export interface RequisitionsService {
  createRequisition(input: CreateRequisitionInput): Promise<Requisition>;
  submitRequisition(args: {
    readonly id: RequisitionId;
    readonly category?: VendorCategory | 'all';
  }): Promise<{
    readonly requisition: Requisition;
    readonly availability: { readonly available: number; readonly blocked: boolean };
  }>;
  cancelRequisition(args: { readonly id: RequisitionId; readonly reason: string }): Promise<Requisition>;
  markAsConverted(args: {
    readonly id: RequisitionId;
    readonly toRfqId?: string;
    readonly toPoId?: string;
  }): Promise<Requisition>;
}

export interface RequisitionsServiceDeps {
  readonly dataPort: ProcurementDataPort;
  readonly approvalEngine: ApprovalEnginePort;
  readonly clock?: ClockPort;
  readonly idFactory?: () => string;
  /** When true (default), submit() will block the requisition if the
   *  attached budget cannot cover its estimated total. */
  readonly blockOnOverBudget?: boolean;
}

export function createRequisitionsService(deps: RequisitionsServiceDeps): RequisitionsService {
  const clock = deps.clock ?? SYSTEM_CLOCK;
  const idFactory = deps.idFactory ?? defaultIdFactory;
  const port = deps.dataPort;
  const blockOnOverBudget = deps.blockOnOverBudget ?? true;

  return {
    async createRequisition(rawInput) {
      const input = CreateRequisitionSchema.parse(rawInput);
      const items: ReadonlyArray<RequisitionItem> = input.items.map((it) => ({
        sku: it.sku ?? null,
        description: it.description,
        qty: it.qty,
        unit: it.unit,
        estimatedUnitPrice: it.estimatedUnitPrice,
        currency: it.currency.toUpperCase() as CurrencyCode,
        subtotal: round2(it.qty * it.estimatedUnitPrice),
      }));
      const total = items.reduce((s, i) => s + i.subtotal, 0);
      const currency = items[0]?.currency ?? 'USD';
      if (items.some((i) => i.currency !== currency)) {
        throw new Error('All requisition items must use the same currency');
      }
      const requisition: Requisition = {
        id: `req_${idFactory()}`,
        tenantId: input.tenantId,
        requestedBy: input.requestedBy,
        department: input.department ?? null,
        propertyId: input.propertyId ?? null,
        items,
        estimatedTotal: round2(total),
        currency,
        justification: input.justification,
        urgency: input.urgency ?? 'normal',
        status: 'draft',
        budgetId: (input.budgetId as Budget['id']) ?? null,
        approvalChainId: null,
        createdAt: clock.now().toISOString(),
        submittedAt: null,
        decidedAt: null,
        rfqId: null,
        poId: null,
      };
      await port.insertRequisition(requisition);
      return requisition;
    },

    async submitRequisition(args) {
      const requisition = await port.findRequisition(args.id);
      if (!requisition) {
        throw new Error(`Requisition ${args.id} not found`);
      }
      if (requisition.status !== 'draft') {
        throw new Error(`Cannot submit requisition in '${requisition.status}' status`);
      }

      // Budget pre-check + reservation.
      let availability = { available: Infinity, blocked: false };
      if (requisition.budgetId) {
        const budget = await port.findBudget(requisition.budgetId);
        if (!budget) {
          throw new Error(`Attached budget ${requisition.budgetId} not found`);
        }
        const available =
          budget.amount - budget.spent - budget.committed - budget.reserved;
        const wouldOverspend = requisition.estimatedTotal > available;
        availability = { available, blocked: wouldOverspend && blockOnOverBudget };
        if (wouldOverspend && blockOnOverBudget) {
          return { requisition, availability };
        }
        const updatedBudget: Budget = {
          ...budget,
          reserved: budget.reserved + requisition.estimatedTotal,
        };
        await port.updateBudget(updatedBudget);
      }

      // Resolve approval chain.
      const chain = await deps.approvalEngine.resolveChain({
        tenantId: requisition.tenantId,
        subjectKind: 'requisition',
        subjectId: requisition.id,
        amount: requisition.estimatedTotal,
        currency: requisition.currency,
        category: args.category ?? 'all',
      });

      const updated: Requisition = {
        ...requisition,
        status: 'submitted',
        submittedAt: clock.now().toISOString(),
        approvalChainId: chain.id,
      };
      await port.updateRequisition(updated);
      return { requisition: updated, availability };
    },

    async cancelRequisition(args) {
      const requisition = await port.findRequisition(args.id);
      if (!requisition) {
        throw new Error(`Requisition ${args.id} not found`);
      }
      if (requisition.status === 'converted_to_rfq' || requisition.status === 'converted_to_po') {
        throw new Error(`Cannot cancel a converted requisition`);
      }
      // Release the reservation if one was made.
      if (requisition.budgetId && requisition.status === 'submitted') {
        const budget = await port.findBudget(requisition.budgetId);
        if (budget) {
          const updatedBudget: Budget = {
            ...budget,
            reserved: Math.max(0, budget.reserved - requisition.estimatedTotal),
          };
          await port.updateBudget(updatedBudget);
        }
      }
      const updated: Requisition = {
        ...requisition,
        status: 'cancelled',
        decidedAt: clock.now().toISOString(),
        justification: `${requisition.justification}\n\n[cancelled] ${args.reason}`,
      };
      await port.updateRequisition(updated);
      return updated;
    },

    async markAsConverted(args) {
      const requisition = await port.findRequisition(args.id);
      if (!requisition) {
        throw new Error(`Requisition ${args.id} not found`);
      }
      if (requisition.status !== 'approved') {
        throw new Error(`Can only convert approved requisitions (was '${requisition.status}')`);
      }
      const status = args.toPoId ? 'converted_to_po' : 'converted_to_rfq';
      const updated: Requisition = {
        ...requisition,
        status,
        rfqId: (args.toRfqId as Requisition['rfqId']) ?? null,
        poId: (args.toPoId as Requisition['poId']) ?? null,
      };
      await port.updateRequisition(updated);
      return updated;
    },
  };
}

/**
 * Helper for the approval-engine callbacks — pushes the requisition
 * from 'submitted' to 'approved' or 'rejected' when the chain
 * resolves.
 */
export async function applyApprovalOutcome(
  port: ProcurementDataPort,
  reqId: RequisitionId,
  outcome: 'approved' | 'rejected',
  clock: ClockPort = SYSTEM_CLOCK,
): Promise<Requisition> {
  const requisition = await port.findRequisition(reqId);
  if (!requisition) {
    throw new Error(`Requisition ${reqId} not found`);
  }
  if (requisition.status !== 'submitted') {
    throw new Error(`Requisition ${reqId} is '${requisition.status}', not 'submitted'`);
  }
  // On rejection: release the reservation.
  if (outcome === 'rejected' && requisition.budgetId) {
    const budget = await port.findBudget(requisition.budgetId);
    if (budget) {
      const updatedBudget: Budget = {
        ...budget,
        reserved: Math.max(0, budget.reserved - requisition.estimatedTotal),
      };
      await port.updateBudget(updatedBudget);
    }
  }
  const updated: Requisition = {
    ...requisition,
    status: outcome,
    decidedAt: clock.now().toISOString(),
  };
  await port.updateRequisition(updated);
  return updated;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

let counter = 0;
function defaultIdFactory(): string {
  counter += 1;
  return `${Date.now().toString(36)}_${counter.toString(36)}`;
}
