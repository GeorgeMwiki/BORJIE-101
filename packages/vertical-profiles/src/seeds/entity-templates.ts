/**
 * Per-vertical entity templates (Wave VP-1).
 *
 * Reserved profiles inherit a vertical-default entity skeleton (≥6
 * entities per vertical) so they satisfy the spec's "≥6 entities for
 * reserved profiles" requirement without each definition having to
 * spell them out.
 *
 * Live profiles (mining-tz) ship their own deeper, richer entity
 * set in `@borjie/vertical-profile-mining-tz`. The mining template
 * here is the fallback used by other mining-* reserved profiles.
 *
 * @module @borjie/vertical-profiles/seeds/entity-templates
 */

import type { Vertical, VerticalEntityDefinition } from '../types.js';

function ent(
  key: string,
  displayName: string,
  description: string,
  attributes: VerticalEntityDefinition['attributes'],
  parentKey?: string,
): VerticalEntityDefinition {
  return parentKey !== undefined
    ? Object.freeze({ key, displayName, parentKey, description, attributes })
    : Object.freeze({ key, displayName, description, attributes });
}

const ID_STRING = Object.freeze({
  key: 'id',
  kind: 'string' as const,
  required: true,
});
const NAME_STRING = Object.freeze({
  key: 'name',
  kind: 'string' as const,
  required: true,
});
const GEO_OPTIONAL = Object.freeze({
  key: 'geo',
  kind: 'geo' as const,
  required: false,
});

// ---------------------------------------------------------------------------
// Mining (used by mining-{ke,ng,za,au,cl,pe,ca,ru,id,ph})
// ---------------------------------------------------------------------------

const MINING_ENTITIES: ReadonlyArray<VerticalEntityDefinition> = Object.freeze([
  ent('mine_site', 'Mine Site', 'Geolocated polygon under a mineral right.', [
    ID_STRING,
    NAME_STRING,
    GEO_OPTIONAL,
    { key: 'holder', kind: 'string', required: true },
    { key: 'licenceRef', kind: 'reference', required: true, referenceEntity: 'licence' },
    {
      key: 'status',
      kind: 'enum',
      required: true,
      enumValues: ['active', 'care-and-maintenance', 'closed'],
    },
  ]),
  ent('pit', 'Pit', 'Open-pit excavation inside a mine site.', [
    ID_STRING,
    NAME_STRING,
    { key: 'mineSiteRef', kind: 'reference', required: true, referenceEntity: 'mine_site' },
    { key: 'depthMetres', kind: 'number', required: false },
  ], 'mine_site'),
  ent('shaft', 'Shaft', 'Underground access shaft.', [
    ID_STRING,
    NAME_STRING,
    { key: 'mineSiteRef', kind: 'reference', required: true, referenceEntity: 'mine_site' },
    { key: 'depthMetres', kind: 'number', required: true },
  ], 'mine_site'),
  ent('stockpile', 'Stockpile', 'Surface inventory of mined material.', [
    ID_STRING,
    NAME_STRING,
    { key: 'tonnes', kind: 'number', required: true },
    { key: 'gradeGramsPerTonne', kind: 'number', required: false },
  ]),
  ent('licence', 'Licence', 'Mineral right or operating licence.', [
    ID_STRING,
    { key: 'kind', kind: 'string', required: true },
    { key: 'expiresAt', kind: 'date', required: true },
  ]),
  ent('royalty_filing', 'Royalty Filing', 'Periodic royalty filing to the mining regulator.', [
    ID_STRING,
    {
      key: 'kind',
      kind: 'enum',
      required: true,
      enumValues: ['monthly', 'quarterly', 'annual'],
    },
    { key: 'dueAt', kind: 'date', required: true },
    {
      key: 'status',
      kind: 'enum',
      required: true,
      enumValues: ['draft', 'filed', 'overdue'],
    },
  ]),
]);

// ---------------------------------------------------------------------------
// Agri
// ---------------------------------------------------------------------------

const AGRI_ENTITIES: ReadonlyArray<VerticalEntityDefinition> = Object.freeze([
  ent('farm', 'Farm', 'Productive agricultural holding.', [
    ID_STRING,
    NAME_STRING,
    GEO_OPTIONAL,
    { key: 'totalHectares', kind: 'number', required: true },
    { key: 'holder', kind: 'string', required: true },
  ]),
  ent('field', 'Field', 'Sub-parcel within a farm.', [
    ID_STRING,
    NAME_STRING,
    { key: 'farmRef', kind: 'reference', required: true, referenceEntity: 'farm' },
    { key: 'hectares', kind: 'number', required: true },
  ], 'farm'),
  ent('crop', 'Crop', 'Planted commodity in a field.', [
    ID_STRING,
    NAME_STRING,
    { key: 'fieldRef', kind: 'reference', required: true, referenceEntity: 'field' },
    { key: 'plantedAt', kind: 'date', required: true },
  ]),
  ent('harvest', 'Harvest', 'Collected output from a crop.', [
    ID_STRING,
    { key: 'cropRef', kind: 'reference', required: true, referenceEntity: 'crop' },
    { key: 'kilograms', kind: 'number', required: true },
    { key: 'harvestedAt', kind: 'date', required: true },
  ]),
  ent('cooperative', 'Cooperative', 'Farmer cooperative aggregating output.', [
    ID_STRING,
    NAME_STRING,
    { key: 'memberCount', kind: 'number', required: true },
  ]),
  ent('export_permit', 'Export Permit', 'Permit for cross-border movement of agricultural commodity.', [
    ID_STRING,
    { key: 'commodity', kind: 'string', required: true },
    { key: 'destinationCountry', kind: 'string', required: true },
    { key: 'expiresAt', kind: 'date', required: true },
  ]),
]);

// ---------------------------------------------------------------------------
// Oil & Gas
// ---------------------------------------------------------------------------

const OILGAS_ENTITIES: ReadonlyArray<VerticalEntityDefinition> = Object.freeze([
  ent('block', 'Block', 'Licensed petroleum exploration / production block.', [
    ID_STRING,
    NAME_STRING,
    GEO_OPTIONAL,
    { key: 'holder', kind: 'string', required: true },
    { key: 'phase', kind: 'enum', required: true, enumValues: ['exploration', 'development', 'production', 'abandonment'] },
  ]),
  ent('platform', 'Platform', 'Offshore production platform.', [
    ID_STRING,
    NAME_STRING,
    { key: 'blockRef', kind: 'reference', required: true, referenceEntity: 'block' },
    { key: 'waterDepthMetres', kind: 'number', required: false },
  ]),
  ent('well', 'Well', 'Production / injection well within a block.', [
    ID_STRING,
    NAME_STRING,
    { key: 'blockRef', kind: 'reference', required: true, referenceEntity: 'block' },
    { key: 'kind', kind: 'enum', required: true, enumValues: ['exploration', 'production', 'injection', 'abandoned'] },
  ]),
  ent('pipeline', 'Pipeline', 'Fluid-transport pipeline segment.', [
    ID_STRING,
    NAME_STRING,
    { key: 'lengthKm', kind: 'number', required: true },
    { key: 'fluid', kind: 'enum', required: true, enumValues: ['oil', 'gas', 'condensate', 'water'] },
  ]),
  ent('jv_partner', 'Joint Venture Partner', 'Contractual JV partner share-holder.', [
    ID_STRING,
    NAME_STRING,
    { key: 'sharePercent', kind: 'number', required: true },
  ]),
  ent('lease', 'Lease', 'Petroleum lease agreement.', [
    ID_STRING,
    { key: 'blockRef', kind: 'reference', required: true, referenceEntity: 'block' },
    { key: 'expiresAt', kind: 'date', required: true },
  ]),
]);

// ---------------------------------------------------------------------------
// Fisheries
// ---------------------------------------------------------------------------

const FISHERIES_ENTITIES: ReadonlyArray<VerticalEntityDefinition> = Object.freeze([
  ent('vessel', 'Vessel', 'Licensed fishing vessel.', [
    ID_STRING,
    NAME_STRING,
    { key: 'imoNumber', kind: 'string', required: false },
    { key: 'flagCountry', kind: 'string', required: true },
    { key: 'lengthMetres', kind: 'number', required: false },
  ]),
  ent('quota', 'Quota', 'Catch quota allocation.', [
    ID_STRING,
    { key: 'species', kind: 'string', required: true },
    { key: 'tonnes', kind: 'number', required: true },
    { key: 'periodLabel', kind: 'string', required: true },
  ]),
  ent('catch_log', 'Catch Log', 'Periodic catch record.', [
    ID_STRING,
    { key: 'vesselRef', kind: 'reference', required: true, referenceEntity: 'vessel' },
    { key: 'species', kind: 'string', required: true },
    { key: 'kilograms', kind: 'number', required: true },
    { key: 'caughtAt', kind: 'date', required: true },
  ]),
  ent('harbour', 'Harbour', 'Landing harbour / fishing port.', [
    ID_STRING,
    NAME_STRING,
    GEO_OPTIONAL,
  ]),
  ent('skipper', 'Skipper', 'Master of a fishing vessel.', [
    ID_STRING,
    NAME_STRING,
    { key: 'licenceRef', kind: 'string', required: false },
  ]),
  ent('buyer', 'Buyer', 'Buyer of landed catch.', [
    ID_STRING,
    NAME_STRING,
    { key: 'accreditation', kind: 'string', required: false },
  ]),
]);

// ---------------------------------------------------------------------------
// Forestry
// ---------------------------------------------------------------------------

const FORESTRY_ENTITIES: ReadonlyArray<VerticalEntityDefinition> = Object.freeze([
  ent('concession', 'Concession', 'Forestry concession area.', [
    ID_STRING,
    NAME_STRING,
    GEO_OPTIONAL,
    { key: 'hectares', kind: 'number', required: true },
    { key: 'expiresAt', kind: 'date', required: true },
  ]),
  ent('compartment', 'Compartment', 'Sub-area inside a concession.', [
    ID_STRING,
    NAME_STRING,
    { key: 'concessionRef', kind: 'reference', required: true, referenceEntity: 'concession' },
    { key: 'hectares', kind: 'number', required: true },
  ], 'concession'),
  ent('felling_plan', 'Felling Plan', 'Approved felling schedule.', [
    ID_STRING,
    { key: 'compartmentRef', kind: 'reference', required: true, referenceEntity: 'compartment' },
    { key: 'volumeM3', kind: 'number', required: true },
  ]),
  ent('truck_bol', 'Truck Bill of Lading', 'Movement permit for harvested timber.', [
    ID_STRING,
    { key: 'volumeM3', kind: 'number', required: true },
    { key: 'destination', kind: 'string', required: true },
  ]),
  ent('inspector_audit', 'Inspector Audit', 'Forest-inspector audit visit.', [
    ID_STRING,
    { key: 'concessionRef', kind: 'reference', required: true, referenceEntity: 'concession' },
    { key: 'inspectedAt', kind: 'date', required: true },
    { key: 'score', kind: 'number', required: false },
  ]),
  ent('carbon_account', 'Carbon Account', 'REDD+-aligned carbon stock account.', [
    ID_STRING,
    { key: 'concessionRef', kind: 'reference', required: true, referenceEntity: 'concession' },
    { key: 'tonnesCO2e', kind: 'number', required: true },
  ]),
]);

// ---------------------------------------------------------------------------
// Manufacturing
// ---------------------------------------------------------------------------

const MANUFACTURING_ENTITIES: ReadonlyArray<VerticalEntityDefinition> = Object.freeze([
  ent('factory', 'Factory', 'Production facility.', [
    ID_STRING,
    NAME_STRING,
    GEO_OPTIONAL,
    { key: 'employeeCount', kind: 'number', required: false },
  ]),
  ent('production_line', 'Production Line', 'Line within a factory.', [
    ID_STRING,
    NAME_STRING,
    { key: 'factoryRef', kind: 'reference', required: true, referenceEntity: 'factory' },
    { key: 'capacityUnitsPerHour', kind: 'number', required: false },
  ], 'factory'),
  ent('sku', 'SKU', 'Stock-keeping unit.', [
    ID_STRING,
    NAME_STRING,
    { key: 'unitPriceLocal', kind: 'number', required: false },
  ]),
  ent('bom', 'Bill of Materials', 'Recipe for a SKU.', [
    ID_STRING,
    { key: 'skuRef', kind: 'reference', required: true, referenceEntity: 'sku' },
  ]),
  ent('customs_filing', 'Customs Filing', 'Cross-border movement filing.', [
    ID_STRING,
    { key: 'kind', kind: 'enum', required: true, enumValues: ['import', 'export'] },
    { key: 'value', kind: 'number', required: true },
  ]),
  ent('worker', 'Worker', 'Production worker.', [
    ID_STRING,
    NAME_STRING,
    { key: 'factoryRef', kind: 'reference', required: true, referenceEntity: 'factory' },
  ]),
]);

// ---------------------------------------------------------------------------
// Tourism
// ---------------------------------------------------------------------------

const TOURISM_ENTITIES: ReadonlyArray<VerticalEntityDefinition> = Object.freeze([
  ent('lodge', 'Lodge', 'Hospitality unit.', [
    ID_STRING,
    NAME_STRING,
    GEO_OPTIONAL,
    { key: 'roomCount', kind: 'number', required: true },
  ]),
  ent('tour_operator', 'Tour Operator', 'Licensed operator.', [
    ID_STRING,
    NAME_STRING,
    { key: 'licenceNumber', kind: 'string', required: true },
  ]),
  ent('trip', 'Trip', 'Booked trip / safari / package.', [
    ID_STRING,
    NAME_STRING,
    { key: 'startsAt', kind: 'date', required: true },
    { key: 'endsAt', kind: 'date', required: true },
    { key: 'guestCount', kind: 'number', required: true },
  ]),
  ent('concession_fee_filing', 'Concession Fee Filing', 'Periodic concession-fee filing.', [
    ID_STRING,
    { key: 'periodLabel', kind: 'string', required: true },
    { key: 'amount', kind: 'number', required: true },
  ]),
  ent('guide_licence', 'Guide Licence', 'Licensed tour guide.', [
    ID_STRING,
    { key: 'holder', kind: 'string', required: true },
    { key: 'expiresAt', kind: 'date', required: true },
  ]),
  ent('park_permit', 'Park Permit', 'Protected-area access permit.', [
    ID_STRING,
    { key: 'park', kind: 'string', required: true },
    { key: 'expiresAt', kind: 'date', required: true },
  ]),
]);

// ---------------------------------------------------------------------------
// Real estate
// ---------------------------------------------------------------------------

const REALESTATE_ENTITIES: ReadonlyArray<VerticalEntityDefinition> = Object.freeze([
  ent('tower', 'Tower', 'Multi-unit residential or commercial tower.', [
    ID_STRING,
    NAME_STRING,
    GEO_OPTIONAL,
    { key: 'unitCount', kind: 'number', required: true },
  ]),
  ent('unit', 'Unit', 'Sellable / rentable unit inside a tower.', [
    ID_STRING,
    { key: 'towerRef', kind: 'reference', required: true, referenceEntity: 'tower' },
    { key: 'areaSqm', kind: 'number', required: true },
  ], 'tower'),
  ent('title_deed', 'Title Deed', 'Registered ownership document.', [
    ID_STRING,
    { key: 'unitRef', kind: 'reference', required: true, referenceEntity: 'unit' },
    { key: 'holder', kind: 'string', required: true },
  ]),
  ent('rera_filing', 'Regulator Filing', 'Periodic real-estate regulator filing.', [
    ID_STRING,
    { key: 'kind', kind: 'string', required: true },
    { key: 'dueAt', kind: 'date', required: true },
  ]),
  ent('service_charge', 'Service Charge', 'Owner-association service charge levy.', [
    ID_STRING,
    { key: 'periodLabel', kind: 'string', required: true },
    { key: 'amount', kind: 'number', required: true },
  ]),
  ent('tenant_lease', 'Tenant Lease', 'Lease agreement with a tenant.', [
    ID_STRING,
    { key: 'unitRef', kind: 'reference', required: true, referenceEntity: 'unit' },
    { key: 'startsAt', kind: 'date', required: true },
    { key: 'endsAt', kind: 'date', required: true },
    { key: 'monthlyRent', kind: 'number', required: true },
  ]),
]);

// ---------------------------------------------------------------------------
// Lookup map
// ---------------------------------------------------------------------------

export const VERTICAL_ENTITY_TEMPLATES: Readonly<
  Record<Vertical, ReadonlyArray<VerticalEntityDefinition>>
> = Object.freeze({
  mining: MINING_ENTITIES,
  agri: AGRI_ENTITIES,
  oilgas: OILGAS_ENTITIES,
  fisheries: FISHERIES_ENTITIES,
  forestry: FORESTRY_ENTITIES,
  manufacturing: MANUFACTURING_ENTITIES,
  tourism: TOURISM_ENTITIES,
  realestate: REALESTATE_ENTITIES,
});
