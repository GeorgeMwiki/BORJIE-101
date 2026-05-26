/**
 * Framework registry — pluggable catalogue of named compliance
 * regulations (GDPR, TZ DPA 2022, CCPA, LGPD, PIPL, …) with their
 * article registry and the join table that maps an article ref to a
 * Borjie package implementation.
 *
 * Immutable: every mutating op returns a NEW Registry value. Pure
 * data structure — no I/O.
 */

import {
  type ComplianceFramework,
  ComplianceFrameworkSchema,
  type ControlKind,
  type FrameworkControlMapping,
  FrameworkControlMappingSchema,
} from '../types.js';

export interface FrameworkRegistry {
  readonly frameworks: ReadonlyMap<string, ComplianceFramework>;
  /** key = `${framework_id}::${article_ref}::${package_name}` */
  readonly mappings: ReadonlyMap<string, FrameworkControlMapping>;
}

export function emptyFrameworkRegistry(): FrameworkRegistry {
  return {
    frameworks: new Map<string, ComplianceFramework>(),
    mappings: new Map<string, FrameworkControlMapping>(),
  };
}

function mappingKey(m: {
  readonly framework_id: string;
  readonly article_ref: string;
  readonly package_name: string;
}): string {
  return `${m.framework_id}::${m.article_ref}::${m.package_name}`;
}

export function registerFramework(
  reg: FrameworkRegistry,
  framework: ComplianceFramework,
): FrameworkRegistry {
  const parsed = ComplianceFrameworkSchema.parse(framework);
  if (reg.frameworks.has(parsed.id)) {
    throw new Error(`framework_already_registered:${parsed.id}`);
  }
  const next = new Map(reg.frameworks);
  next.set(parsed.id, parsed);
  return { frameworks: next, mappings: reg.mappings };
}

export function registerFrameworks(
  reg: FrameworkRegistry,
  frameworks: ReadonlyArray<ComplianceFramework>,
): FrameworkRegistry {
  let acc = reg;
  for (const f of frameworks) {
    acc = registerFramework(acc, f);
  }
  return acc;
}

export function registerControlMapping(
  reg: FrameworkRegistry,
  mapping: FrameworkControlMapping,
): FrameworkRegistry {
  const parsed = FrameworkControlMappingSchema.parse(mapping);
  if (!reg.frameworks.has(parsed.framework_id)) {
    throw new Error(
      `mapping_references_unknown_framework:${parsed.framework_id}`,
    );
  }
  const key = mappingKey(parsed);
  if (reg.mappings.has(key)) {
    throw new Error(`mapping_already_registered:${key}`);
  }
  const next = new Map(reg.mappings);
  next.set(key, parsed);
  return { frameworks: reg.frameworks, mappings: next };
}

export function registerControlMappings(
  reg: FrameworkRegistry,
  mappings: ReadonlyArray<FrameworkControlMapping>,
): FrameworkRegistry {
  let acc = reg;
  for (const m of mappings) {
    acc = registerControlMapping(acc, m);
  }
  return acc;
}

export function findFramework(
  reg: FrameworkRegistry,
  id: string,
): ComplianceFramework | undefined {
  return reg.frameworks.get(id);
}

export function requireFramework(
  reg: FrameworkRegistry,
  id: string,
): ComplianceFramework {
  const f = reg.frameworks.get(id);
  if (!f) {
    throw new Error(`framework_not_registered:${id}`);
  }
  return f;
}

export function listFrameworkIds(
  reg: FrameworkRegistry,
): ReadonlyArray<string> {
  return Array.from(reg.frameworks.keys()).sort();
}

/**
 * Find all control mappings for a given framework.
 */
export function findMappingsForFramework(
  reg: FrameworkRegistry,
  frameworkId: string,
): ReadonlyArray<FrameworkControlMapping> {
  const out: FrameworkControlMapping[] = [];
  for (const m of reg.mappings.values()) {
    if (m.framework_id === frameworkId) {
      out.push(m);
    }
  }
  return out;
}

/**
 * Find all control mappings of a specific control kind across all
 * frameworks (e.g. every `breach-notification` mapping).
 */
export function findMappingsByControlKind(
  reg: FrameworkRegistry,
  kind: ControlKind,
): ReadonlyArray<FrameworkControlMapping> {
  const out: FrameworkControlMapping[] = [];
  for (const m of reg.mappings.values()) {
    if (m.control_kind === kind) {
      out.push(m);
    }
  }
  return out;
}

/**
 * Find all frameworks that apply to a given jurisdiction id.
 */
export function findFrameworksForJurisdiction(
  reg: FrameworkRegistry,
  jurisdictionId: string,
): ReadonlyArray<ComplianceFramework> {
  const out: ComplianceFramework[] = [];
  for (const f of reg.frameworks.values()) {
    if (f.jurisdictions.includes(jurisdictionId)) {
      out.push(f);
    }
  }
  return out;
}
