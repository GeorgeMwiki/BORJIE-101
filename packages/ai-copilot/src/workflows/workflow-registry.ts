/**
 * Workflow Registry — canonical catalog of BORJIE's multi-step flows.
 *
 * Each workflow is a deterministic chain of typed steps. Steps can be:
 *   - ai: delegated to a persona to produce structured output
 *   - tool: a named skill/tool invocation
 *   - human: human approval required before continuing
 *   - notify: side-effect-only notification dispatch
 *
 * The engine (workflow-engine.ts) executes steps in order, respecting
 * idempotency keys so the same run-id cannot double-execute.
 */

import { z } from 'zod';

export const StepKindSchema = z.enum(['ai', 'tool', 'human', 'notify']);
export type StepKind = z.infer<typeof StepKindSchema>;

export const WorkflowStepSchema = z.object({
  id: z.string().min(1),
  kind: StepKindSchema,
  title: z.string().min(1),
  description: z.string(),
  /** Named persona, tool, or notification channel depending on kind. */
  target: z.string().min(1),
  /** Required roles — the initiator must hold at least one. */
  requires: z.array(z.string()).default([]),
  /** If true and kind=human, execution pauses until an advance call arrives. */
  blocksUntilApproved: z.boolean().default(false),
});
export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;

export interface WorkflowDefinition {
  readonly id: string;
  readonly version: string;
  readonly name: string;
  readonly description: string;
  readonly steps: readonly WorkflowStep[];
  readonly defaultRoles: readonly string[];
}

const def = (wf: WorkflowDefinition): WorkflowDefinition => wf;

export const WORKFLOWS: readonly WorkflowDefinition[] = [
  def({
    id: 'onboard_new_property',
    version: '1.0.0',
    name: 'Onboard new property',
    description: 'Create a property, seed units, bind owner, and index lease templates.',
    defaultRoles: ['OWNER', 'MANAGER', 'ADMIN'],
    steps: [
      { id: 'collect_details', kind: 'ai', title: 'Collect property details', description: 'Mr. Mwikila interviews the owner for address, unit count, amenities.', target: 'leasing', requires: [], blocksUntilApproved: false },
      { id: 'create_property', kind: 'tool', title: 'Create property record', description: 'Write property + units to the domain.', target: 'tool:property.create', requires: [], blocksUntilApproved: false },
      { id: 'bind_owner', kind: 'tool', title: 'Bind owner to property', description: 'Attach owner record.', target: 'tool:property.bind_owner', requires: [], blocksUntilApproved: false },
      { id: 'index_templates', kind: 'tool', title: 'Index lease templates', description: 'Populate the knowledge store with country lease templates.', target: 'tool:knowledge.index_templates', requires: [], blocksUntilApproved: false },
      { id: 'confirm', kind: 'notify', title: 'Notify owner', description: 'Send confirmation email/SMS.', target: 'notify:owner', requires: [], blocksUntilApproved: false },
    ],
  }),
  def({
    id: 'process_rent_payment',
    version: '1.0.0',
    name: 'Process rent payment',
    description: 'Match a payment callback to an invoice and issue a receipt.',
    defaultRoles: ['OWNER', 'MANAGER'],
    steps: [
      { id: 'reconcile', kind: 'tool', title: 'Reconcile payment', description: 'Match M-Pesa/Azam/MTN callback.', target: 'tool:payment.reconcile', requires: [], blocksUntilApproved: false },
      { id: 'allocate', kind: 'tool', title: 'Allocate to invoice', description: 'Apply to oldest open invoice.', target: 'tool:payment.allocate', requires: [], blocksUntilApproved: false },
      { id: 'receipt', kind: 'tool', title: 'Issue receipt', description: 'Render + store receipt PDF.', target: 'tool:receipt.render', requires: [], blocksUntilApproved: false },
      { id: 'notify_tenant', kind: 'notify', title: 'Notify tenant', description: 'Deliver receipt via preferred channel.', target: 'notify:tenant', requires: [], blocksUntilApproved: false },
    ],
  }),
  def({
    id: 'resolve_maintenance_case',
    version: '1.0.0',
    name: 'Resolve maintenance case end-to-end',
    description: 'Triage, assign, complete, and close a maintenance case.',
    defaultRoles: ['MANAGER', 'STATION_MASTER'],
    steps: [
      { id: 'triage', kind: 'ai', title: 'Triage case', description: 'Mr. Mwikila classifies severity + estimated cost.', target: 'maintenance', requires: [], blocksUntilApproved: false },
      { id: 'assign_vendor', kind: 'tool', title: 'Assign vendor', description: 'Select best-fit vendor.', target: 'tool:vendor.assign', requires: [], blocksUntilApproved: false },
      { id: 'dispatch_work_order', kind: 'tool', title: 'Dispatch work order', description: 'Create and send work order.', target: 'tool:work_order.create', requires: [], blocksUntilApproved: false },
      { id: 'await_completion', kind: 'human', title: 'Confirm completion', description: 'Station master signs off completion.', target: 'human:station_master', requires: ['STATION_MASTER', 'MANAGER'], blocksUntilApproved: true },
      { id: 'invoice_owner', kind: 'tool', title: 'Charge owner for work', description: 'Generate owner invoice for the cost.', target: 'tool:invoice.owner', requires: [], blocksUntilApproved: false },
      { id: 'close_case', kind: 'tool', title: 'Close case', description: 'Mark resolved.', target: 'tool:case.close', requires: [], blocksUntilApproved: false },
    ],
  }),
  def({
    id: 'execute_lease_renewal',
    version: '1.0.0',
    name: 'Execute lease renewal',
    description: 'Generate renewal options, negotiate, sign new lease.',
    defaultRoles: ['OWNER', 'MANAGER'],
    steps: [
      { id: 'propose_options', kind: 'ai', title: 'Propose renewal options', description: 'Leasing persona generates conservative/market/premium.', target: 'leasing', requires: [], blocksUntilApproved: false },
      { id: 'owner_approve', kind: 'human', title: 'Owner approval', description: 'Owner picks one option.', target: 'human:owner', requires: ['OWNER'], blocksUntilApproved: true },
      { id: 'send_to_tenant', kind: 'notify', title: 'Send offer to tenant', description: 'Deliver chosen option.', target: 'notify:tenant', requires: [], blocksUntilApproved: false },
      { id: 'tenant_respond', kind: 'human', title: 'Tenant responds', description: 'Tenant accepts, counters, or declines.', target: 'human:tenant', requires: [], blocksUntilApproved: true },
      { id: 'draft_new_lease', kind: 'tool', title: 'Draft new lease', description: 'Render lease doc from accepted terms.', target: 'tool:lease.draft', requires: [], blocksUntilApproved: false },
      { id: 'collect_signatures', kind: 'human', title: 'Collect signatures', description: 'Both parties sign.', target: 'human:both', requires: [], blocksUntilApproved: true },
      { id: 'activate_lease', kind: 'tool', title: 'Activate lease', description: 'Commit new lease live.', target: 'tool:lease.activate', requires: [], blocksUntilApproved: false },
    ],
  }),
  def({
    id: 'run_arrears_recovery_ladder',
    version: '1.0.0',
    name: 'Run arrears recovery ladder',
    description: 'Escalate unpaid rent through gentle -> firm -> formal stages.',
    defaultRoles: ['OWNER', 'MANAGER'],
    steps: [
      { id: 'open_case', kind: 'tool', title: 'Open arrears case', description: 'Record new case.', target: 'tool:arrears.open', requires: [], blocksUntilApproved: false },
      { id: 'gentle_reminder', kind: 'notify', title: 'Send gentle reminder', description: 'Day 3 reminder.', target: 'notify:tenant', requires: [], blocksUntilApproved: false },
      { id: 'firm_reminder', kind: 'notify', title: 'Send firm reminder', description: 'Day 10 reminder.', target: 'notify:tenant', requires: [], blocksUntilApproved: false },
      { id: 'owner_approval', kind: 'human', title: 'Owner approval', description: 'Owner authorises formal demand.', target: 'human:owner', requires: ['OWNER'], blocksUntilApproved: true },
      { id: 'formal_demand', kind: 'tool', title: 'Generate formal demand', description: 'Render statutory notice.', target: 'tool:letters.formal_demand', requires: [], blocksUntilApproved: false },
      { id: 'escalate_compliance', kind: 'ai', title: 'Compliance escalation advice', description: 'Compliance persona advises next legal step.', target: 'compliance', requires: [], blocksUntilApproved: false },
    ],
  }),
  def({
    id: 'execute_move_out_inspection',
    version: '1.0.0',
    name: 'Execute tenant move-out inspection',
    description: 'Schedule, perform, reconcile deposit, finalise.',
    defaultRoles: ['MANAGER', 'STATION_MASTER'],
    steps: [
      { id: 'schedule', kind: 'tool', title: 'Schedule inspection', description: 'Book the slot.', target: 'tool:inspection.schedule', requires: [], blocksUntilApproved: false },
      { id: 'conduct', kind: 'human', title: 'Conduct inspection', description: 'Station master walks through.', target: 'human:station_master', requires: ['STATION_MASTER', 'MANAGER'], blocksUntilApproved: true },
      { id: 'photos_and_notes', kind: 'tool', title: 'Upload photos + notes', description: 'Commit condition evidence.', target: 'tool:inspection.evidence', requires: [], blocksUntilApproved: false },
      { id: 'reconcile_deposit', kind: 'ai', title: 'Reconcile deposit', description: 'Finance persona computes deductions.', target: 'finance', requires: [], blocksUntilApproved: false },
      { id: 'owner_approval', kind: 'human', title: 'Owner approval', description: 'Owner approves final deduction.', target: 'human:owner', requires: ['OWNER'], blocksUntilApproved: true },
      { id: 'refund', kind: 'tool', title: 'Issue refund', description: 'Release remaining deposit.', target: 'tool:refund.issue', requires: [], blocksUntilApproved: false },
    ],
  }),
  def({
    id: 'onboard_new_tenant',
    version: '1.0.0',
    name: 'Onboard a new tenant',
    description: 'Screen, draft lease, collect deposit, hand over keys.',
    defaultRoles: ['OWNER', 'MANAGER'],
    steps: [
      { id: 'screen', kind: 'ai', title: 'Screen tenant', description: 'Tenant 5P health check.', target: 'leasing', requires: [], blocksUntilApproved: false },
      { id: 'draft_lease', kind: 'tool', title: 'Draft lease', description: 'Generate lease doc.', target: 'tool:lease.draft', requires: [], blocksUntilApproved: false },
      { id: 'owner_approve', kind: 'human', title: 'Owner approves tenant', description: 'Final go/no-go.', target: 'human:owner', requires: ['OWNER'], blocksUntilApproved: true },
      { id: 'collect_deposit', kind: 'tool', title: 'Collect deposit', description: 'Record payment.', target: 'tool:payment.collect_deposit', requires: [], blocksUntilApproved: false },
      { id: 'move_in_inspection', kind: 'human', title: 'Move-in inspection', description: 'Document condition.', target: 'human:station_master', requires: ['STATION_MASTER', 'MANAGER'], blocksUntilApproved: true },
      { id: 'hand_keys', kind: 'notify', title: 'Hand keys', description: 'Notify tenant.', target: 'notify:tenant', requires: [], blocksUntilApproved: false },
    ],
  }),
  def({
    id: 'draft_monthly_owner_report',
    version: '1.0.0',
    name: 'Draft monthly owner report',
    description: 'Collect data, synthesise insights, generate PDF, deliver.',
    defaultRoles: ['MANAGER', 'ADMIN'],
    steps: [
      { id: 'collect_data', kind: 'tool', title: 'Collect data', description: 'Gather rent, arrears, maintenance, occupancy.', target: 'tool:reports.collect_monthly', requires: [], blocksUntilApproved: false },
      { id: 'synthesise', kind: 'ai', title: 'Synthesise insights', description: 'Advisor persona writes narrative.', target: 'advisor', requires: [], blocksUntilApproved: false },
      { id: 'render_pdf', kind: 'tool', title: 'Render PDF', description: 'Compose PDF.', target: 'tool:reports.render_pdf', requires: [], blocksUntilApproved: false },
      { id: 'deliver', kind: 'notify', title: 'Deliver to owner', description: 'Email/WhatsApp.', target: 'notify:owner', requires: [], blocksUntilApproved: false },
    ],
  }),
  def({
    id: 'vendor_dispatch',
    version: '1.0.0',
    name: 'Dispatch vendor for field work',
    description: 'Select vendor, quote, dispatch, track completion.',
    defaultRoles: ['MANAGER'],
    steps: [
      { id: 'select_vendor', kind: 'ai', title: 'Select vendor', description: 'Maintenance persona picks best vendor.', target: 'maintenance', requires: [], blocksUntilApproved: false },
      { id: 'request_quote', kind: 'notify', title: 'Request quote', description: 'Ask vendor for a quote.', target: 'notify:vendor', requires: [], blocksUntilApproved: false },
      { id: 'approve_quote', kind: 'human', title: 'Approve quote', description: 'Owner/manager approves.', target: 'human:owner', requires: ['OWNER', 'MANAGER'], blocksUntilApproved: true },
      { id: 'dispatch', kind: 'tool', title: 'Dispatch work order', description: 'Create work order.', target: 'tool:work_order.create', requires: [], blocksUntilApproved: false },
      { id: 'close', kind: 'tool', title: 'Close on completion', description: 'Close.', target: 'tool:work_order.close', requires: [], blocksUntilApproved: false },
    ],
  }),
  def({
    id: 'rent_repricing_review',
    version: '1.0.0',
    name: 'Annual rent repricing review',
    description: 'Analyse, recommend new rents, send renewal offers.',
    defaultRoles: ['OWNER', 'MANAGER'],
    steps: [
      { id: 'pull_market_data', kind: 'tool', title: 'Pull market comparables', description: 'Fetch comps.', target: 'tool:market.comps', requires: [], blocksUntilApproved: false },
      { id: 'analyse', kind: 'ai', title: 'Analyse repricing opportunities', description: 'Advisor persona recommends.', target: 'advisor', requires: [], blocksUntilApproved: false },
      { id: 'owner_approve', kind: 'human', title: 'Owner approves new rents', description: 'Owner signs off.', target: 'human:owner', requires: ['OWNER'], blocksUntilApproved: true },
      { id: 'send_offers', kind: 'notify', title: 'Send renewal offers', description: 'Batch deliver.', target: 'notify:tenants', requires: [], blocksUntilApproved: false },
    ],
  }),
];

export function getWorkflow(id: string): WorkflowDefinition | undefined {
  return WORKFLOWS.find((w) => w.id === id);
}

export function listWorkflows(): readonly WorkflowDefinition[] {
  return WORKFLOWS;
}
