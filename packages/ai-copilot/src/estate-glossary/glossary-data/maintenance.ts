/**
 * Maintenance-related glossary (mining domain). Work-order, planned and
 * reactive-maintenance vocabulary for plant, mill, fleet, and pumping.
 * v1 is largely English-only per the spec.
 */

import { buildEntries, enOnlyBatch, type EntrySpec } from './helpers.js';
import type { GlossaryEntry } from '../types.js';

const CORE_SPECS: readonly EntrySpec[] = [
  {
    id: 'maintenance.work_order',
    en: 'work order',
    def: 'A job ticket authorising maintenance or repair work on plant, fleet, or a fixed asset.',
    cat: 'maintenance',
    juris: ['TZ', 'KE', 'GH', 'ZA', 'AU'],
    t: {
      sw: 'amri ya kazi',
      ar: 'أمر عمل',
      fr: 'ordre de travail',
      de: 'Arbeitsauftrag',
      pt: 'ordem de serviço',
      es: 'orden de trabajo',
    },
  },
  {
    id: 'maintenance.planned_preventive',
    en: 'planned preventive maintenance',
    def: 'Scheduled maintenance performed on a fixed cadence to avert plant or fleet failure.',
    cat: 'maintenance',
    juris: ['TZ', 'KE', 'GH', 'ZA', 'AU'],
    t: { de: 'vorbeugende Wartung', fr: 'maintenance préventive' },
  },
  {
    id: 'maintenance.reactive',
    en: 'reactive maintenance',
    def: 'Unscheduled maintenance triggered by a breakdown or operator report.',
    cat: 'maintenance',
    juris: ['TZ', 'KE', 'GH', 'ZA'],
  },
  {
    id: 'maintenance.sla',
    en: 'maintenance SLA',
    def: 'Service-level agreement defining response and completion windows for work categories.',
    cat: 'maintenance',
    juris: ['TZ', 'KE', 'GH', 'ZA', 'AU'],
  },
];

const EXTRA_ROWS: ReadonlyArray<readonly [string, string, string]> = [
  ['maintenance.emergency_call_out', 'emergency call-out', 'Urgent same-day response to critical plant or pit faults.'],
  ['maintenance.fault_code', 'fault code', 'Coded classification of a reported defect.'],
  ['maintenance.snagging_list', 'commissioning punch list', 'List of minor defects identified after plant commissioning.'],
  ['maintenance.defect_period', 'defect liability period', 'Period in which a contractor remains liable for defects.'],
  ['maintenance.first_time_fix_rate', 'first-time-fix rate', 'Percentage of jobs resolved on the first visit.'],
  ['maintenance.mean_time_to_repair', 'mean time to repair', 'Average elapsed time from report to completion.'],
  ['maintenance.mean_time_between_failures', 'mean time between failures', 'Average run time between successive failures of an asset.'],
  ['maintenance.quote', 'quotation', 'Proposed price for a specified scope of work.'],
  ['maintenance.permit_to_work', 'permit to work', 'Formal authorisation for high-risk work (hot, confined, heights, isolation).'],
  ['maintenance.method_statement', 'method statement', 'Document describing how a task will be carried out safely.'],
  ['maintenance.risk_assessment', 'risk assessment', 'Pre-task evaluation of hazards and controls.'],
  ['maintenance.lockout_tagout', 'lockout-tagout (LOTO)', 'Isolation procedure preventing energisation during maintenance.'],
  ['maintenance.parts_stock', 'parts stock', 'Held inventory of spare components used in repairs.'],
  ['maintenance.asset_register', 'asset register', 'Inventory of long-lived plant and fleet and its maintenance history.'],
  ['maintenance.condition_rating', 'condition rating', 'Graded assessment of an asset’s state (A-E).'],
  ['maintenance.planned_renewal', 'planned renewal', 'Scheduled capital replacement of a plant component (e.g. mill liners).'],
  ['maintenance.callout_fee', 'callout fee', 'Standing fee charged by a contractor for attendance.'],
  ['maintenance.out_of_hours', 'out-of-hours service', 'Maintenance cover outside the operating shift.'],
  ['maintenance.warranty_claim', 'warranty claim', 'Request for free repair under a manufacturer warranty.'],
  ['maintenance.make_safe', 'make-safe visit', 'Emergency visit to isolate risk before full repair.'],
];

export const MAINTENANCE_ENTRIES: readonly GlossaryEntry[] = Object.freeze([
  ...buildEntries(CORE_SPECS),
  ...enOnlyBatch('maintenance', ['TZ', 'KE', 'GH'], EXTRA_ROWS),
]);
