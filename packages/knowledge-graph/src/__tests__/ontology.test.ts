/**
 * Ontology tests — schema validation, extension semantics.
 */
import { describe, expect, it } from 'vitest';
import {
  realEstateOntology,
  extendOntology,
  validateOntology,
} from '../ontology/index.js';

describe('realEstateOntology', () => {
  it('includes the core 15 classes', () => {
    const names = new Set(realEstateOntology.classes.map((c) => c.name));
    for (const required of [
      'Property',
      'Unit',
      'Tenant',
      'Owner',
      'EstateManager',
      'Lease',
      'Payment',
      'MaintenanceTicket',
      'Vendor',
      'Document',
      'Inspection',
      'Listing',
      'Lead',
      'Parcel',
      'District',
    ]) {
      expect(names.has(required)).toBe(true);
    }
  });

  it('declares all key real-estate edges', () => {
    const labels = new Set(realEstateOntology.edges.map((e) => e.label));
    for (const required of [
      'hasUnit',
      'occupiedBy',
      'signedLease',
      'leaseOf',
      'generatesPayment',
      'paidBy',
      'managedBy',
      'locatedAt',
      'withinDistrict',
      'raisedTicket',
      'ticketFor',
    ]) {
      expect(labels.has(required)).toBe(true);
    }
  });

  it('passes validateOntology', () => {
    const issues = validateOntology(realEstateOntology);
    expect(issues).toEqual([]);
  });

  it('Property and Unit are aligned with BOT URIs', () => {
    const propClass = realEstateOntology.classes.find((c) => c.name === 'Property');
    const unitClass = realEstateOntology.classes.find((c) => c.name === 'Unit');
    expect(propClass?.canonicalUri).toContain('bot');
    expect(unitClass?.canonicalUri).toContain('bot');
  });
});

describe('extendOntology', () => {
  it('adds tenant classes without losing base classes', () => {
    const extended = extendOntology(realEstateOntology, {
      classes: [
        {
          name: 'CarPark',
          description: 'A parking lot custom to luxury properties.',
        },
      ],
    });
    const names = new Set(extended.classes.map((c) => c.name));
    expect(names.has('Property')).toBe(true);
    expect(names.has('CarPark')).toBe(true);
  });

  it('overrides duplicates with tenant values', () => {
    const extended = extendOntology(realEstateOntology, {
      classes: [
        { name: 'Property', description: 'Custom override description.' },
      ],
    });
    const prop = extended.classes.find((c) => c.name === 'Property');
    expect(prop?.description).toContain('Custom override');
    // Still only one Property class
    const count = extended.classes.filter((c) => c.name === 'Property').length;
    expect(count).toBe(1);
  });

  it('does not mutate the base ontology', () => {
    const beforeCount = realEstateOntology.classes.length;
    extendOntology(realEstateOntology, {
      classes: [{ name: 'NewKind', description: 'x' }],
    });
    expect(realEstateOntology.classes.length).toBe(beforeCount);
  });

  it('appends version suffix when provided', () => {
    const extended = extendOntology(realEstateOntology, {
      versionSuffix: 'tenant-acme',
    });
    expect(extended.version).toContain('+tenant-acme');
  });
});

describe('validateOntology', () => {
  it('catches dangling property class references', () => {
    const issues = validateOntology({
      ...realEstateOntology,
      properties: [
        ...realEstateOntology.properties,
        {
          name: 'orphan',
          onClass: 'DoesNotExist',
          datatype: 'string',
          required: false,
          description: 'broken',
        },
      ],
    });
    expect(issues.some((i) => i.includes('DoesNotExist'))).toBe(true);
  });

  it('catches dangling edge class references', () => {
    const issues = validateOntology({
      ...realEstateOntology,
      edges: [
        ...realEstateOntology.edges,
        {
          label: 'badEdge',
          fromClass: 'GhostA',
          toClass: 'GhostB',
          fromCardinality: 'one',
          toCardinality: 'one',
          description: 'broken',
        },
      ],
    });
    expect(issues.some((i) => i.includes('GhostA'))).toBe(true);
    expect(issues.some((i) => i.includes('GhostB'))).toBe(true);
  });

  it('catches dangling parent class references', () => {
    const issues = validateOntology({
      ...realEstateOntology,
      classes: [
        ...realEstateOntology.classes,
        { name: 'Orphan', parent: 'Ghost', description: 'x' },
      ],
    });
    expect(issues.some((i) => i.includes('Ghost'))).toBe(true);
  });
});
