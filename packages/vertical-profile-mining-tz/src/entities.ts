/**
 * Mining-TZ canonical entities (Wave VP-1).
 *
 * Ten first-class nouns that the LMBM, capability catalogue,
 * workflow engine, and report templates all key off of:
 *
 *   1. Mine Site   — geolocated polygon under a mineral right.
 *   2. Pit         — child of mine site, open-pit instance, bench geometry.
 *   3. Shaft       — underground access shaft, depth, ventilation class.
 *   4. Stockpile   — surface inventory, tonnes, grade, location.
 *   5. Buyer       — gold buyer, mineral category, accreditation, KYC level.
 *   6. Royalty Filing — periodic filing to Tumemadini.
 *   7. Permit      — operational permit (EIA, environmental, water-use).
 *   8. Licence     — mineral right (PML/PL/SML/ML/SMRL).
 *   9. Worker      — workforce member, certifications, KYC, shift assignments.
 *  10. Shift       — work period, gang assignment, attendance, output tonnes.
 *
 * @module @borjie/vertical-profile-mining-tz/entities
 */

import type { VerticalEntityDefinition } from '@borjie/vertical-profiles';

const ID = Object.freeze({
  key: 'id',
  kind: 'string' as const,
  required: true,
});

const NAME = Object.freeze({
  key: 'name',
  kind: 'string' as const,
  required: true,
});

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

export const MINE_SITE_ENTITY: VerticalEntityDefinition = ent(
  'mine_site',
  'Mine Site',
  'Geolocated polygon under a mineral right. Carries holder, status, and the licence reference that grants extraction authority. Per the Mining Act 2010 (as amended 2017) a mine site is the operational unit Tumemadini regulates.',
  [
    ID,
    NAME,
    { key: 'geo', kind: 'geo', required: true },
    { key: 'holder', kind: 'string', required: true },
    { key: 'licenceRef', kind: 'reference', required: true, referenceEntity: 'licence' },
    {
      key: 'status',
      kind: 'enum',
      required: true,
      enumValues: ['active', 'care-and-maintenance', 'closed'],
    },
    { key: 'commodity', kind: 'string', required: true },
  ],
);

export const PIT_ENTITY: VerticalEntityDefinition = ent(
  'pit',
  'Pit',
  'Open-pit excavation instance inside a mine site. Bench geometry captured for slope-stability and reserves estimation.',
  [
    ID,
    NAME,
    { key: 'mineSiteRef', kind: 'reference', required: true, referenceEntity: 'mine_site' },
    { key: 'depthMetres', kind: 'number', required: true },
    { key: 'benchHeightMetres', kind: 'number', required: false },
    {
      key: 'status',
      kind: 'enum',
      required: true,
      enumValues: ['active', 'paused', 'backfilled'],
    },
  ],
  'mine_site',
);

export const SHAFT_ENTITY: VerticalEntityDefinition = ent(
  'shaft',
  'Shaft',
  'Underground access shaft. Depth, ventilation class, and hoist capacity drive safety-audit checklists.',
  [
    ID,
    NAME,
    { key: 'mineSiteRef', kind: 'reference', required: true, referenceEntity: 'mine_site' },
    { key: 'depthMetres', kind: 'number', required: true },
    {
      key: 'ventilationClass',
      kind: 'enum',
      required: true,
      enumValues: ['natural', 'forced-fan', 'mechanical-circuit'],
    },
    { key: 'hoistCapacityKg', kind: 'number', required: false },
  ],
  'mine_site',
);

export const STOCKPILE_ENTITY: VerticalEntityDefinition = ent(
  'stockpile',
  'Stockpile',
  'Surface inventory of mined material awaiting processing or sale. Used to compute working-capital exposure and royalty obligation timing.',
  [
    ID,
    NAME,
    { key: 'mineSiteRef', kind: 'reference', required: true, referenceEntity: 'mine_site' },
    { key: 'tonnes', kind: 'number', required: true },
    { key: 'gradeGramsPerTonne', kind: 'number', required: false },
    { key: 'commodity', kind: 'string', required: true },
  ],
);

export const BUYER_ENTITY: VerticalEntityDefinition = ent(
  'buyer',
  'Buyer',
  'Mineral / gold buyer. Carries accreditation, KYC level, and the regulator-issued buyer code. KYC refresh enforced every 12 months per FATF precious-minerals guidance.',
  [
    ID,
    NAME,
    {
      key: 'kycLevel',
      kind: 'enum',
      required: true,
      enumValues: ['basic', 'enhanced', 'full'],
    },
    { key: 'accreditationNumber', kind: 'string', required: true },
    { key: 'lastKycRefreshAt', kind: 'date', required: true },
    { key: 'commodity', kind: 'string', required: true },
  ],
);

export const ROYALTY_FILING_ENTITY: VerticalEntityDefinition = ent(
  'royalty_filing',
  'Royalty Filing',
  'Periodic royalty filing to Tumemadini (the Mining Commission). Kind = monthly | quarterly | annual. Annual headline is 6% gold royalty + 4% inspection fee per Mining Act 2010 (as amended 2017).',
  [
    ID,
    {
      key: 'kind',
      kind: 'enum',
      required: true,
      enumValues: ['monthly', 'quarterly', 'annual'],
    },
    { key: 'periodLabel', kind: 'string', required: true },
    { key: 'dueAt', kind: 'date', required: true },
    { key: 'filedAt', kind: 'date', required: false },
    {
      key: 'status',
      kind: 'enum',
      required: true,
      enumValues: ['draft', 'filed', 'paid', 'overdue', 'disputed'],
    },
    { key: 'amountTzs', kind: 'number', required: true },
  ],
);

export const PERMIT_ENTITY: VerticalEntityDefinition = ent(
  'permit',
  'Permit',
  'Operational permit (EIA approval, environmental clearance, water-use, blasting). Issued by NEMC or other domain regulators.',
  [
    ID,
    {
      key: 'kind',
      kind: 'enum',
      required: true,
      enumValues: ['eia', 'environmental', 'water-use', 'blasting', 'explosives-storage'],
    },
    { key: 'issuedAt', kind: 'date', required: true },
    { key: 'expiresAt', kind: 'date', required: true },
    { key: 'issuingRegulator', kind: 'string', required: true },
    {
      key: 'status',
      kind: 'enum',
      required: true,
      enumValues: ['active', 'expired', 'revoked'],
    },
  ],
);

export const LICENCE_ENTITY: VerticalEntityDefinition = ent(
  'licence',
  'Licence',
  'Mineral right or operating licence. Kind one of PML (Primary Mining Licence), PL (Prospecting Licence), SML (Special Mining Licence), ML (Mining Licence), SMRL (Special Mineral Right Licence). Issued by Tumemadini.',
  [
    ID,
    {
      key: 'kind',
      kind: 'enum',
      required: true,
      enumValues: ['PML', 'PL', 'SML', 'ML', 'SMRL'],
    },
    { key: 'holder', kind: 'string', required: true },
    { key: 'issuedAt', kind: 'date', required: true },
    { key: 'expiresAt', kind: 'date', required: true },
    {
      key: 'status',
      kind: 'enum',
      required: true,
      enumValues: ['active', 'lapsed', 'suspended', 'revoked'],
    },
  ],
);

export const WORKER_ENTITY: VerticalEntityDefinition = ent(
  'worker',
  'Worker',
  'Workforce member at a mine site. Carries certifications (safety, first-aid, blasting), KYC level, and current shift assignment.',
  [
    ID,
    NAME,
    { key: 'nationalIdRef', kind: 'string', required: true },
    {
      key: 'kycLevel',
      kind: 'enum',
      required: true,
      enumValues: ['basic', 'enhanced', 'full'],
    },
    { key: 'role', kind: 'string', required: true },
    { key: 'lastKycRefreshAt', kind: 'date', required: true },
  ],
);

export const SHIFT_ENTITY: VerticalEntityDefinition = ent(
  'shift',
  'Shift',
  'Work period with a gang assignment. Captures attendance, output tonnes, and any safety incidents for the period.',
  [
    ID,
    { key: 'mineSiteRef', kind: 'reference', required: true, referenceEntity: 'mine_site' },
    { key: 'startsAt', kind: 'date', required: true },
    { key: 'endsAt', kind: 'date', required: true },
    {
      key: 'kind',
      kind: 'enum',
      required: true,
      enumValues: ['day', 'night', 'continuous'],
    },
    { key: 'outputTonnes', kind: 'number', required: false },
  ],
);

export const MINING_TZ_ENTITIES: ReadonlyArray<VerticalEntityDefinition> =
  Object.freeze([
    MINE_SITE_ENTITY,
    PIT_ENTITY,
    SHAFT_ENTITY,
    STOCKPILE_ENTITY,
    BUYER_ENTITY,
    ROYALTY_FILING_ENTITY,
    PERMIT_ENTITY,
    LICENCE_ENTITY,
    WORKER_ENTITY,
    SHIFT_ENTITY,
  ]);
