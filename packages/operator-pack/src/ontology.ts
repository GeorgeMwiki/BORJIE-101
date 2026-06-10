/**
 * The operator/business REA ontology — the economic world the platform operator
 * runs itself in. Expressed in @borjie/business-ontology primitives so it is the
 * SAME shape a customer-vertical pack uses, only relabelled (cash/AR/AP/payroll
 * here vs mineral-lot/royalty/licence in the mining pack). The double-entry
 * BALANCE of every monetary event is enforced downstream by LedgerService.post();
 * this ontology declares WHAT the events are and which resources they transfer.
 */

import type { DomainOntology } from '@borjie/business-ontology';

const CCY = 'currency_minor_units';

export const operatorBusinessOntology: DomainOntology = {
  domain: 'operator-business',
  resources: [
    { key: 'cash', label: 'Cash', measuredIn: CCY, accountClass: 'asset' },
    { key: 'accounts_receivable', label: 'Accounts receivable', measuredIn: CCY, accountClass: 'asset' },
    { key: 'accounts_payable', label: 'Accounts payable', measuredIn: CCY, accountClass: 'liability' },
    { key: 'payroll_liability', label: 'Payroll liability', measuredIn: CCY, accountClass: 'liability' },
    { key: 'subscription_revenue', label: 'Subscription revenue', measuredIn: CCY, accountClass: 'revenue' },
    { key: 'operating_expense', label: 'Operating expense', measuredIn: CCY, accountClass: 'expense' },
    { key: 'retained_earnings', label: 'Retained earnings', measuredIn: CCY, accountClass: 'equity' },
    { key: 'headcount', label: 'Headcount', measuredIn: 'count', accountClass: 'operational' },
  ],
  agents: [
    { key: 'legal_entity', label: 'The company', internal: true },
    { key: 'employee', label: 'Employee', internal: true },
    { key: 'customer', label: 'Customer', internal: false },
    { key: 'vendor', label: 'Vendor', internal: false },
    { key: 'tax_authority', label: 'Tax authority', internal: false },
  ],
  events: [
    {
      key: 'subscription_billed',
      label: 'Bill a customer subscription',
      effects: [
        { resourceKey: 'accounts_receivable', flow: 'increment' },
        { resourceKey: 'subscription_revenue', flow: 'decrement' },
      ],
      providerAgentKey: 'legal_entity',
      receiverAgentKey: 'customer',
      isMonetary: true,
    },
    {
      key: 'payment_collected',
      label: 'Collect a customer payment',
      effects: [
        { resourceKey: 'cash', flow: 'increment' },
        { resourceKey: 'accounts_receivable', flow: 'decrement' },
      ],
      providerAgentKey: 'customer',
      receiverAgentKey: 'legal_entity',
      isMonetary: true,
    },
    {
      key: 'expense_accrued',
      label: 'Accrue a vendor expense',
      effects: [
        { resourceKey: 'operating_expense', flow: 'decrement' },
        { resourceKey: 'accounts_payable', flow: 'increment' },
      ],
      providerAgentKey: 'vendor',
      receiverAgentKey: 'legal_entity',
      isMonetary: true,
    },
    {
      key: 'vendor_paid',
      label: 'Pay a vendor bill',
      effects: [
        { resourceKey: 'accounts_payable', flow: 'decrement' },
        { resourceKey: 'cash', flow: 'decrement' },
      ],
      providerAgentKey: 'legal_entity',
      receiverAgentKey: 'vendor',
      isMonetary: true,
    },
    {
      key: 'payroll_accrued',
      label: 'Accrue payroll',
      effects: [
        { resourceKey: 'operating_expense', flow: 'decrement' },
        { resourceKey: 'payroll_liability', flow: 'increment' },
      ],
      providerAgentKey: 'employee',
      receiverAgentKey: 'legal_entity',
      isMonetary: true,
    },
    {
      key: 'payroll_paid',
      label: 'Run payroll',
      effects: [
        { resourceKey: 'payroll_liability', flow: 'decrement' },
        { resourceKey: 'cash', flow: 'decrement' },
      ],
      providerAgentKey: 'legal_entity',
      receiverAgentKey: 'employee',
      isMonetary: true,
    },
    {
      key: 'employee_onboarded',
      label: 'Onboard an employee',
      effects: [
        { resourceKey: 'headcount', flow: 'increment' },
        { resourceKey: 'payroll_liability', flow: 'increment' },
      ],
      providerAgentKey: 'legal_entity',
      receiverAgentKey: 'employee',
      isMonetary: false,
    },
    {
      key: 'journal_post',
      label: 'Post a general-ledger journal',
      effects: [
        { resourceKey: 'cash', flow: 'increment' },
        { resourceKey: 'retained_earnings', flow: 'decrement' },
      ],
      providerAgentKey: 'legal_entity',
      receiverAgentKey: 'legal_entity',
      isMonetary: true,
    },
  ],
  commitments: [
    { key: 'subscription', label: 'Subscription', fulfilledByEventKey: 'subscription_billed' },
    { key: 'purchase_order', label: 'Purchase order', fulfilledByEventKey: 'expense_accrued' },
    { key: 'payroll_run', label: 'Payroll run', fulfilledByEventKey: 'payroll_accrued' },
  ],
  policies: [
    { key: 'four_eye_approval', label: 'Four-eye approval', appliesToCategory: 'event' },
    { key: 'autonomy_tier', label: 'Autonomy tier', appliesToCategory: 'event' },
    { key: 'stage_gate', label: 'Stage gate', appliesToCategory: 'event' },
  ],
};
