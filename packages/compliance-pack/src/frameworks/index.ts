/**
 * Frameworks barrel + cross-reference helpers.
 *
 * The 10 catalogs are imported eagerly so consumers can query the
 * union (e.g. "which controls does feature X satisfy across every
 * framework?") without per-call I/O.
 */

import type {
  ComplianceFramework,
  ControlCatalog,
  ControlMapping,
  ControlSpec,
  Jurisdiction,
} from '../types.js';

import { ccpaCatalog } from './ccpa-controls.js';
import { gdprCatalog } from './gdpr-articles.js';
import { iso27001Catalog } from './iso27001-controls.js';
import { keDpaCatalog } from './ke-dpa-controls.js';
import { ngNdprCatalog } from './ng-ndpr-controls.js';
import { popiaCatalog } from './popia-controls.js';
import { rwDpaCatalog } from './rw-dpa-controls.js';
import { soc2Catalog } from './soc2-controls.js';
import { tzDpaCatalog } from './tz-dpa-controls.js';
import { ugDpaCatalog } from './ug-dpa-controls.js';

export {
  ccpaCatalog,
  gdprCatalog,
  iso27001Catalog,
  keDpaCatalog,
  ngNdprCatalog,
  popiaCatalog,
  rwDpaCatalog,
  soc2Catalog,
  tzDpaCatalog,
  ugDpaCatalog,
};

/** Every bundled catalog, keyed by framework code. */
export const ALL_CATALOGS: Readonly<Record<ComplianceFramework, ControlCatalog>> = {
  soc2: soc2Catalog,
  iso27001: iso27001Catalog,
  gdpr: gdprCatalog,
  ccpa: ccpaCatalog,
  popia: popiaCatalog,
  'tz-dpa': tzDpaCatalog,
  'ke-dpa': keDpaCatalog,
  'ug-dpa': ugDpaCatalog,
  'rw-dpa': rwDpaCatalog,
  'ng-ndpr': ngNdprCatalog,
};

/** Flat list of every catalog (useful for iteration). */
export const ALL_CATALOGS_LIST: ReadonlyArray<ControlCatalog> =
  Object.values(ALL_CATALOGS);

/**
 * Every control across every catalog, paired with its framework id so
 * callers can build an inverted index. Computed once at module load.
 */
function buildAllControlMappings(): ReadonlyArray<ControlMapping> {
  const out: ControlMapping[] = [];
  for (const catalog of ALL_CATALOGS_LIST) {
    for (const control of catalog.controls) {
      for (const featureId of control.satisfiedBy) {
        out.push({
          frameworkId: catalog.frameworkId,
          controlId: control.id,
          featureId,
        });
      }
    }
  }
  return Object.freeze(out);
}

export const ALL_CONTROL_MAPPINGS: ReadonlyArray<ControlMapping> =
  buildAllControlMappings();

// ─────────────────────────────────────────────────────────────────────
// Cross-reference helpers
// ─────────────────────────────────────────────────────────────────────

/**
 * All controls scoped to a given jurisdiction. Pass `'GLOBAL'` to get
 * audit-standard controls (SOC2 / ISO27001) that apply everywhere.
 */
export function controlsByJurisdiction(
  jurisdiction: Jurisdiction,
): ReadonlyArray<{ readonly frameworkId: ComplianceFramework; readonly control: ControlSpec }> {
  const out: Array<{ readonly frameworkId: ComplianceFramework; readonly control: ControlSpec }> = [];
  for (const catalog of ALL_CATALOGS_LIST) {
    for (const control of catalog.controls) {
      if (control.jurisdiction === jurisdiction) {
        out.push({ frameworkId: catalog.frameworkId, control });
      }
    }
  }
  return Object.freeze(out);
}

/**
 * Which features (and the controls they satisfy) are claimed across
 * every framework. Inverted index — "what does `featureId` satisfy?".
 */
export function controlsSatisfiedByFeature(
  featureId: string,
): ReadonlyArray<{ readonly frameworkId: ComplianceFramework; readonly controlId: string }> {
  const out: Array<{ readonly frameworkId: ComplianceFramework; readonly controlId: string }> = [];
  for (const mapping of ALL_CONTROL_MAPPINGS) {
    if (mapping.featureId === featureId) {
      out.push({ frameworkId: mapping.frameworkId, controlId: mapping.controlId });
    }
  }
  return Object.freeze(out);
}

/**
 * The features that claim to satisfy a given control id (within an
 * optional framework filter). The most common audit query.
 */
export function featuresSatisfyingControl(
  controlId: string,
  framework?: ComplianceFramework,
): ReadonlyArray<string> {
  const seen = new Set<string>();
  for (const mapping of ALL_CONTROL_MAPPINGS) {
    if (mapping.controlId !== controlId) continue;
    if (framework !== undefined && mapping.frameworkId !== framework) continue;
    seen.add(mapping.featureId);
  }
  return Object.freeze([...seen]);
}

/** A single catalog by framework code. */
export function catalogByFramework(framework: ComplianceFramework): ControlCatalog {
  return ALL_CATALOGS[framework];
}
