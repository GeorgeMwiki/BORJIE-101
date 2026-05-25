/**
 * `realEstateOntology` — the BORJIE domain ontology.
 *
 * Aligned with:
 *   - BOT (Building Topology Ontology, W3C LBD)
 *     https://w3c-lbd-cg.github.io/bot/
 *   - RealEstateCore (used by Microsoft Smart Buildings)
 *     https://www.realestatecore.io/
 *   - schema.org Residence / RealEstateListing / RealEstateAgent
 *   - Brick Schema (https://brickschema.org/) for sensor / device classes
 *   - PROV-O for derivation provenance
 *
 * The ontology is intentionally compact — only the entities that BORJIE
 * actually traverses in GraphRAG queries. Tenants extend it with
 * `extendOntology(realEstateOntology, tenantExtras)`.
 */

import type {
  OntologyDef,
  OntologyClass,
  PropertyConstraint,
  EdgeConstraint,
} from '../types.js';

const CLASSES: ReadonlyArray<OntologyClass> = [
  {
    name: 'Property',
    canonicalUri: 'https://w3id.org/bot#Building',
    description:
      'A managed building — single house, apartment block, or commercial property.',
  },
  {
    name: 'Unit',
    canonicalUri: 'https://w3id.org/bot#Space',
    parent: 'Property',
    description:
      'A rentable unit inside a property: apartment, room, parking bay, or shop.',
  },
  {
    name: 'Parcel',
    canonicalUri: 'https://schema.org/LandPlot',
    description:
      'A registered land parcel — title-deed level entity. May host multiple properties.',
  },
  {
    name: 'District',
    canonicalUri: 'https://schema.org/AdministrativeArea',
    description:
      'Sub-locational area (Nairobi: Westlands, Kilimani, Karen). Used for market analytics.',
  },
  {
    name: 'Tenant',
    canonicalUri: 'https://schema.org/Person',
    description:
      'A renter — natural person or company occupying a Unit under a Lease.',
  },
  {
    name: 'Owner',
    canonicalUri: 'https://schema.org/Person',
    description: 'Beneficial owner of one or more Properties.',
  },
  {
    name: 'EstateManager',
    canonicalUri: 'https://schema.org/Person',
    description:
      'Day-to-day property manager: assigned to Property; receives Tickets.',
  },
  {
    name: 'Lease',
    canonicalUri: 'https://schema.org/LeaseAction',
    description: 'A contract binding a Tenant to a Unit for a term.',
  },
  {
    name: 'Payment',
    canonicalUri: 'https://schema.org/PayAction',
    description: 'A monetary payment — rent, deposit, fee.',
  },
  {
    name: 'MaintenanceTicket',
    canonicalUri: 'https://schema.org/RepairAction',
    description: 'A repair or maintenance work item.',
  },
  {
    name: 'Vendor',
    canonicalUri: 'https://schema.org/Organization',
    description: 'A trade contractor or service provider.',
  },
  {
    name: 'Document',
    canonicalUri: 'https://schema.org/DigitalDocument',
    description: 'Any stored document — lease PDF, invoice, photo.',
  },
  {
    name: 'Inspection',
    description: 'A unit walk-through event, dated, with findings.',
  },
  {
    name: 'Listing',
    canonicalUri: 'https://schema.org/RealEstateListing',
    description: 'A marketed availability — drives lead generation.',
  },
  {
    name: 'Lead',
    description: 'A prospective tenant / buyer who showed interest.',
  },
];

const PROPERTIES: ReadonlyArray<PropertyConstraint> = [
  // Property
  {
    name: 'name',
    onClass: 'Property',
    datatype: 'string',
    required: true,
    description: 'Human-readable property name.',
  },
  {
    name: 'address',
    onClass: 'Property',
    datatype: 'string',
    required: true,
    description: 'Postal address.',
  },
  {
    name: 'unitCount',
    onClass: 'Property',
    datatype: 'number',
    required: false,
    description: 'Number of rentable units (denormalised cache).',
  },
  // Unit
  {
    name: 'unitNumber',
    onClass: 'Unit',
    datatype: 'string',
    required: true,
    description: 'Apartment / room number.',
  },
  {
    name: 'bedrooms',
    onClass: 'Unit',
    datatype: 'number',
    required: false,
    description: 'Bedroom count.',
  },
  {
    name: 'monthlyRent',
    onClass: 'Unit',
    datatype: 'number',
    required: false,
    description: 'Current asking rent (minor units of tenant base currency).',
  },
  // Tenant
  {
    name: 'fullName',
    onClass: 'Tenant',
    datatype: 'string',
    required: true,
    description: 'Tenant legal name (pseudonymised in cross-tenant slices).',
  },
  {
    name: 'phone',
    onClass: 'Tenant',
    datatype: 'string',
    required: false,
    description: 'Primary contact (E.164).',
  },
  // Lease
  {
    name: 'startDate',
    onClass: 'Lease',
    datatype: 'date',
    required: true,
    description: 'Lease start (ISO date).',
  },
  {
    name: 'endDate',
    onClass: 'Lease',
    datatype: 'date',
    required: false,
    description: 'Lease end (open-ended leases leave null).',
  },
  {
    name: 'rentMinor',
    onClass: 'Lease',
    datatype: 'number',
    required: true,
    description: 'Contracted monthly rent (minor units).',
  },
  // Payment
  {
    name: 'amountMinor',
    onClass: 'Payment',
    datatype: 'number',
    required: true,
    description: 'Amount in minor units.',
  },
  {
    name: 'paidAt',
    onClass: 'Payment',
    datatype: 'date',
    required: true,
    description: 'Settlement date (ISO).',
  },
  // MaintenanceTicket
  {
    name: 'priority',
    onClass: 'MaintenanceTicket',
    datatype: 'string',
    required: true,
    description: 'Priority enum: low / medium / high / urgent.',
  },
  {
    name: 'status',
    onClass: 'MaintenanceTicket',
    datatype: 'string',
    required: true,
    description: 'Status enum: open / in_progress / closed.',
  },
  // District
  {
    name: 'jurisdiction',
    onClass: 'District',
    datatype: 'string',
    required: true,
    description: 'ISO-3166-1 alpha-2 country code.',
  },
];

const EDGES: ReadonlyArray<EdgeConstraint> = [
  {
    label: 'hasUnit',
    fromClass: 'Property',
    toClass: 'Unit',
    fromCardinality: 'one',
    toCardinality: 'many',
    description: 'Property contains Unit (BOT:hasSpace).',
  },
  {
    label: 'occupiedBy',
    fromClass: 'Unit',
    toClass: 'Tenant',
    fromCardinality: 'one',
    toCardinality: 'many',
    description: 'Unit is currently occupied by Tenant.',
  },
  {
    label: 'signedLease',
    fromClass: 'Tenant',
    toClass: 'Lease',
    fromCardinality: 'many',
    toCardinality: 'one',
    description: 'Tenant is party to Lease.',
  },
  {
    label: 'leaseOf',
    fromClass: 'Lease',
    toClass: 'Unit',
    fromCardinality: 'many',
    toCardinality: 'one',
    description: 'Lease covers Unit.',
  },
  {
    label: 'generatesPayment',
    fromClass: 'Lease',
    toClass: 'Payment',
    fromCardinality: 'one',
    toCardinality: 'many',
    description: 'Lease yields Payment events.',
  },
  {
    label: 'paidBy',
    fromClass: 'Payment',
    toClass: 'Tenant',
    fromCardinality: 'many',
    toCardinality: 'one',
    description: 'Payment was made by Tenant.',
  },
  {
    label: 'ownedBy',
    fromClass: 'Property',
    toClass: 'Owner',
    fromCardinality: 'many',
    toCardinality: 'many',
    description: 'Property has beneficial Owner.',
  },
  {
    label: 'managedBy',
    fromClass: 'Property',
    toClass: 'EstateManager',
    fromCardinality: 'one',
    toCardinality: 'many',
    description: 'Property is managed by EstateManager.',
  },
  {
    label: 'locatedAt',
    fromClass: 'Property',
    toClass: 'Parcel',
    fromCardinality: 'many',
    toCardinality: 'one',
    description: 'Property sits on Parcel.',
  },
  {
    label: 'withinDistrict',
    fromClass: 'Parcel',
    toClass: 'District',
    fromCardinality: 'many',
    toCardinality: 'one',
    description: 'Parcel is in District.',
  },
  {
    label: 'raisedTicket',
    fromClass: 'Tenant',
    toClass: 'MaintenanceTicket',
    fromCardinality: 'one',
    toCardinality: 'many',
    description: 'Tenant raised MaintenanceTicket.',
  },
  {
    label: 'ticketFor',
    fromClass: 'MaintenanceTicket',
    toClass: 'Unit',
    fromCardinality: 'many',
    toCardinality: 'one',
    description: 'Ticket concerns Unit.',
  },
  {
    label: 'assignedVendor',
    fromClass: 'MaintenanceTicket',
    toClass: 'Vendor',
    fromCardinality: 'many',
    toCardinality: 'many',
    description: 'Ticket assigned to Vendor.',
  },
  {
    label: 'hasDocument',
    fromClass: 'Lease',
    toClass: 'Document',
    fromCardinality: 'many',
    toCardinality: 'many',
    description: 'Lease backed by Document.',
  },
  {
    label: 'inspected',
    fromClass: 'Inspection',
    toClass: 'Unit',
    fromCardinality: 'many',
    toCardinality: 'one',
    description: 'Inspection observed Unit.',
  },
  {
    label: 'listedAs',
    fromClass: 'Unit',
    toClass: 'Listing',
    fromCardinality: 'one',
    toCardinality: 'many',
    description: 'Unit is marketed via Listing.',
  },
  {
    label: 'leadOn',
    fromClass: 'Lead',
    toClass: 'Listing',
    fromCardinality: 'many',
    toCardinality: 'one',
    description: 'Lead inquired about Listing.',
  },
];

export const realEstateOntology: OntologyDef = {
  name: 'BORJIE.realEstate',
  version: '1.0.0',
  classes: CLASSES,
  properties: PROPERTIES,
  edges: EDGES,
};

/**
 * Extend an ontology with tenant-specific classes / properties / edges.
 * Returns a new ontology; never mutates the input. Conflicts (same
 * class name) prefer the tenant's extras — they win.
 */
export function extendOntology(
  base: OntologyDef,
  extras: {
    readonly classes?: ReadonlyArray<OntologyClass>;
    readonly properties?: ReadonlyArray<PropertyConstraint>;
    readonly edges?: ReadonlyArray<EdgeConstraint>;
    readonly versionSuffix?: string;
  },
): OntologyDef {
  const overrideClassNames = new Set((extras.classes ?? []).map((c) => c.name));
  const baseClasses = base.classes.filter((c) => !overrideClassNames.has(c.name));

  const overridePropKeys = new Set(
    (extras.properties ?? []).map((p) => `${p.onClass}::${p.name}`),
  );
  const baseProps = base.properties.filter(
    (p) => !overridePropKeys.has(`${p.onClass}::${p.name}`),
  );

  const overrideEdgeKeys = new Set(
    (extras.edges ?? []).map((e) => `${e.fromClass}-${e.label}->${e.toClass}`),
  );
  const baseEdges = base.edges.filter(
    (e) => !overrideEdgeKeys.has(`${e.fromClass}-${e.label}->${e.toClass}`),
  );

  return {
    name: base.name,
    version: extras.versionSuffix
      ? `${base.version}+${extras.versionSuffix}`
      : base.version,
    classes: [...baseClasses, ...(extras.classes ?? [])],
    properties: [...baseProps, ...(extras.properties ?? [])],
    edges: [...baseEdges, ...(extras.edges ?? [])],
  };
}

/**
 * Validate an ontology. Returns a list of issues; empty when valid.
 */
export function validateOntology(ont: OntologyDef): ReadonlyArray<string> {
  const issues: string[] = [];
  const classNames = new Set(ont.classes.map((c) => c.name));

  // Every property must point at a known class
  for (const p of ont.properties) {
    if (!classNames.has(p.onClass)) {
      issues.push(
        `Property "${p.name}" references unknown class "${p.onClass}"`,
      );
    }
  }

  // Every edge endpoint must be known
  for (const e of ont.edges) {
    if (!classNames.has(e.fromClass)) {
      issues.push(
        `Edge "${e.label}" has unknown fromClass "${e.fromClass}"`,
      );
    }
    if (!classNames.has(e.toClass)) {
      issues.push(`Edge "${e.label}" has unknown toClass "${e.toClass}"`);
    }
  }

  // Parent classes must be known
  for (const c of ont.classes) {
    if (c.parent && !classNames.has(c.parent)) {
      issues.push(`Class "${c.name}" has unknown parent "${c.parent}"`);
    }
  }

  return issues;
}
