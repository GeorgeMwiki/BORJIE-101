import { describe, it, expect } from 'vitest';
import {
  validateDomainOntology,
  monetaryEvents,
  resourcesOfClass,
} from '@borjie/business-ontology';
import {
  operatorBusinessOntology,
  operatorPack,
  OPERATOR_DRIVES,
} from '../index.js';

describe('operator-pack ontology', () => {
  it('is a valid REA ontology (integrity + duality)', () => {
    const r = validateDomainOntology(operatorBusinessOntology);
    expect(r.issues).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('models a full money cycle — every monetary event hits the ledger path', () => {
    const monetary = monetaryEvents(operatorBusinessOntology).map((e) => e.key);
    // The core AP/AR/payroll/GL money cycle is present; employee_onboarded is
    // the one non-monetary (HR) event.
    expect(monetary).toContain('subscription_billed');
    expect(monetary).toContain('payment_collected');
    expect(monetary).toContain('vendor_paid');
    expect(monetary).toContain('payroll_paid');
    expect(monetary).not.toContain('employee_onboarded');
  });

  it('spans the five accounting classes (asset/liability/equity/revenue/expense)', () => {
    for (const cls of ['asset', 'liability', 'equity', 'revenue', 'expense'] as const) {
      expect(resourcesOfClass(operatorBusinessOntology, cls).length).toBeGreaterThan(0);
    }
  });
});

describe('operator-pack manifest', () => {
  it('is the UNIVERSAL operator pack', () => {
    expect(operatorPack.universal).toBe(true);
    expect(operatorPack.packId).toBe('operator-business');
    expect(operatorPack.ontology).toBe(operatorBusinessOntology);
  });

  it('declares operator drives that each watch a real ontology resource', () => {
    expect(OPERATOR_DRIVES.length).toBeGreaterThanOrEqual(5);
    const resourceKeys = new Set(operatorBusinessOntology.resources.map((r) => r.key));
    for (const d of OPERATOR_DRIVES) {
      expect(resourceKeys.has(d.watches)).toBe(true);
    }
  });
});
