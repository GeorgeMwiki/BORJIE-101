import { describe, it, expect } from 'vitest';
import {
  validateDomainOntology,
  eventsTouchingResource,
  resourcesOfClass,
  monetaryEvents,
  type DomainOntology,
} from '../index.js';

/** A tiny, well-formed slice of the operator/business ontology. */
const businessSlice: DomainOntology = {
  domain: 'operator-business',
  resources: [
    { key: 'cash', label: 'Cash', measuredIn: 'currency_minor_units', accountClass: 'asset' },
    { key: 'accounts_receivable', label: 'Accounts receivable', measuredIn: 'currency_minor_units', accountClass: 'asset' },
    { key: 'subscription_revenue', label: 'Subscription revenue', measuredIn: 'currency_minor_units', accountClass: 'revenue' },
    { key: 'accounts_payable', label: 'Accounts payable', measuredIn: 'currency_minor_units', accountClass: 'liability' },
  ],
  agents: [
    { key: 'legal_entity', label: 'The company', internal: true },
    { key: 'customer', label: 'Customer', internal: false },
    { key: 'vendor', label: 'Vendor', internal: false },
  ],
  events: [
    {
      key: 'invoice_issue',
      label: 'Issue a customer invoice',
      // duality: AR up, revenue recognized (a credit decrements the equity-side
      // claim modelled here as a give) — increment + decrement present.
      effects: [
        { resourceKey: 'accounts_receivable', flow: 'increment' },
        { resourceKey: 'subscription_revenue', flow: 'decrement' },
      ],
      providerAgentKey: 'legal_entity',
      receiverAgentKey: 'customer',
      isMonetary: true,
    },
    {
      key: 'bill_pay',
      label: 'Pay a vendor bill',
      effects: [
        { resourceKey: 'cash', flow: 'decrement' },
        { resourceKey: 'accounts_payable', flow: 'increment' },
      ],
      providerAgentKey: 'legal_entity',
      receiverAgentKey: 'vendor',
      isMonetary: true,
    },
  ],
  commitments: [
    { key: 'invoice', label: 'Invoice', fulfilledByEventKey: 'invoice_issue' },
  ],
  policies: [
    { key: 'four_eye_approval', label: 'Four-eye approval', appliesToCategory: 'event' },
  ],
};

describe('business-ontology validateDomainOntology', () => {
  it('accepts a well-formed REA ontology', () => {
    const r = validateDomainOntology(businessSlice);
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it('rejects an event that violates REA duality (no give/take pair)', () => {
    const broken: DomainOntology = {
      ...businessSlice,
      events: [
        {
          key: 'one_sided',
          label: 'One-sided',
          effects: [{ resourceKey: 'cash', flow: 'increment' }], // only increment
          providerAgentKey: 'legal_entity',
          receiverAgentKey: 'customer',
          isMonetary: true,
        },
      ],
      commitments: [],
    };
    const r = validateDomainOntology(broken);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'DUALITY_VIOLATION')).toBe(true);
  });

  it('catches a dangling resource/agent/event reference', () => {
    const dangling: DomainOntology = {
      ...businessSlice,
      events: [
        {
          key: 'bad_refs',
          label: 'Bad refs',
          effects: [
            { resourceKey: 'ghost_resource', flow: 'increment' },
            { resourceKey: 'cash', flow: 'decrement' },
          ],
          providerAgentKey: 'ghost_agent',
          receiverAgentKey: 'customer',
          isMonetary: false,
        },
      ],
      commitments: [
        { key: 'c', label: 'C', fulfilledByEventKey: 'ghost_event' },
      ],
    };
    const r = validateDomainOntology(dangling);
    expect(r.ok).toBe(false);
    const codes = r.issues.map((i) => i.code);
    expect(codes).toContain('UNKNOWN_RESOURCE');
    expect(codes).toContain('UNKNOWN_AGENT');
    expect(codes).toContain('UNKNOWN_EVENT');
  });

  it('flags duplicate keys within a category', () => {
    const dup: DomainOntology = {
      ...businessSlice,
      resources: [...businessSlice.resources, businessSlice.resources[0]!],
    };
    const r = validateDomainOntology(dup);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'DUPLICATE_KEY')).toBe(true);
  });

  it('rejects a structurally-invalid candidate (shape)', () => {
    const r = validateDomainOntology({ domain: 'x', resources: [] });
    expect(r.ok).toBe(false);
    expect(r.issues[0]?.code).toBe('SHAPE_INVALID');
  });
});

describe('business-ontology read helpers', () => {
  it('finds every event touching a resource', () => {
    const touching = eventsTouchingResource(businessSlice, 'cash').map((e) => e.key);
    expect(touching).toEqual(['bill_pay']);
  });

  it('filters resources by accounting class', () => {
    expect(resourcesOfClass(businessSlice, 'asset').map((r) => r.key)).toEqual([
      'cash',
      'accounts_receivable',
    ]);
    expect(resourcesOfClass(businessSlice, 'liability').map((r) => r.key)).toEqual([
      'accounts_payable',
    ]);
  });

  it('lists the monetary events (the LedgerService.post path)', () => {
    expect(monetaryEvents(businessSlice).map((e) => e.key)).toEqual([
      'invoice_issue',
      'bill_pay',
    ]);
  });
});
