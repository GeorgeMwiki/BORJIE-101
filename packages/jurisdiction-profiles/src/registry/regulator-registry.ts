/**
 * Regulator registry — pluggable catalogue of per-jurisdiction
 * regulators (`tz-tra`, `tz-tumemadini`, `tz-nemc`, `tz-bot`, etc.).
 *
 * Immutable; pure data structure.
 */

import {
  type RegulatorDefinition,
  RegulatorDefinitionSchema,
  type RegulatorDomain,
} from '../types.js';

export interface RegulatorRegistry {
  readonly regulators: ReadonlyMap<string, RegulatorDefinition>;
}

export function emptyRegulatorRegistry(): RegulatorRegistry {
  return { regulators: new Map<string, RegulatorDefinition>() };
}

export function registerRegulator(
  reg: RegulatorRegistry,
  regulator: RegulatorDefinition,
): RegulatorRegistry {
  const parsed = RegulatorDefinitionSchema.parse(regulator);
  if (reg.regulators.has(parsed.id)) {
    throw new Error(`regulator_already_registered:${parsed.id}`);
  }
  const next = new Map(reg.regulators);
  next.set(parsed.id, parsed);
  return { regulators: next };
}

export function registerRegulators(
  reg: RegulatorRegistry,
  regulators: ReadonlyArray<RegulatorDefinition>,
): RegulatorRegistry {
  let acc = reg;
  for (const r of regulators) {
    acc = registerRegulator(acc, r);
  }
  return acc;
}

export function findRegulator(
  reg: RegulatorRegistry,
  id: string,
): RegulatorDefinition | undefined {
  return reg.regulators.get(id);
}

export function requireRegulator(
  reg: RegulatorRegistry,
  id: string,
): RegulatorDefinition {
  const r = reg.regulators.get(id);
  if (!r) {
    throw new Error(`regulator_not_registered:${id}`);
  }
  return r;
}

export function listRegulatorIds(
  reg: RegulatorRegistry,
): ReadonlyArray<string> {
  return Array.from(reg.regulators.keys()).sort();
}

export function findRegulatorsForJurisdiction(
  reg: RegulatorRegistry,
  jurisdictionId: string,
): ReadonlyArray<RegulatorDefinition> {
  const out: RegulatorDefinition[] = [];
  for (const r of reg.regulators.values()) {
    if (r.jurisdiction_id === jurisdictionId) {
      out.push(r);
    }
  }
  return out;
}

export function findRegulatorsByDomain(
  reg: RegulatorRegistry,
  domain: RegulatorDomain,
): ReadonlyArray<RegulatorDefinition> {
  const out: RegulatorDefinition[] = [];
  for (const r of reg.regulators.values()) {
    if (r.domain === domain) {
      out.push(r);
    }
  }
  return out;
}
