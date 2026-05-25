/**
 * Pure heuristic entity-type + field-map proposer. Runs FIRST, before any
 * LLM call. If the heuristic confidence is above AUTO_MAP_THRESHOLD, the
 * pipeline can skip the LLM entirely — saving cost + latency on the easy
 * cases (which are most cases: a CSV with headers like "full_name, email,
 * phone, department" maps to `employee` with no ambiguity).
 */

import type { InferredSchema } from '../schema-sniff/types.js';
import type { EntityTypeDescriptor } from '../entity-store/IEntityStoreService.js';

import type { EntityMappingProposal, ProposalConflict } from './types.js';

/**
 * Synonym table mapping common header patterns to canonical attribute keys.
 * Keys are lower-case; values are arrays of patterns to match. Patterns are
 * tested as substring matches AFTER normalising the header (strip
 * whitespace, lower-case, drop non-alphanumerics).
 */
const SYNONYMS: ReadonlyMap<string, ReadonlyArray<string>> = new Map([
  ['full_name', ['fullname', 'name', 'employeename', 'leadname', 'tenantname', 'customername']],
  ['email', ['email', 'emailaddress', 'workemail', 'contactemail']],
  ['phone', ['phone', 'phonenumber', 'mobile', 'cell', 'msisdn', 'contactphone']],
  ['role', ['role', 'jobtitle', 'title', 'position']],
  ['department', ['department', 'dept', 'team', 'division']],
  ['start_date', ['startdate', 'hiredate', 'joindate', 'employmentstart']],
  ['salary', ['salary', 'wage', 'compensation', 'baseSalary', 'monthlypay']],
  ['national_id', ['nationalid', 'nida', 'idnumber', 'governmentid']],
  ['source', ['source', 'channel', 'campaign', 'origin']],
  ['stage', ['stage', 'pipelinestage', 'leadstage', 'status']],
  ['budget', ['budget', 'estimatedbudget', 'spendingrange']],
  ['notes', ['notes', 'comment', 'comments', 'remark', 'remarks']],
  ['reference', ['reference', 'ref', 'code', 'id', 'propertyref', 'propertyid', 'sku']],
  ['address', ['address', 'streetaddress', 'location', 'fulladdress']],
  ['city', ['city', 'town', 'municipality']],
  ['unit_count', ['unitcount', 'units', 'numberofunits', 'totalunits']],
  ['monthly_rent', ['monthlyrent', 'rent', 'rentamount', 'rentkes']],
  ['valuation', ['valuation', 'value', 'marketvalue', 'appraisedvalue']],
  ['manager', ['manager', 'propertymanager', 'assignedmanager']],
  ['name', ['name', 'vendorname', 'companyname']],
  ['category', ['category', 'vendorcategory', 'type', 'serviceType']],
  ['contact_email', ['contactemail', 'vendoremail', 'email']],
  ['contact_phone', ['contactphone', 'vendorphone', 'phone', 'mobile']],
  ['tin', ['tin', 'taxid', 'taxnumber']],
  ['rating', ['rating', 'score', 'vendorrating']],
  ['tenant_ref', ['tenantref', 'tenantid', 'tenant', 'tenantcode']],
  ['amount', ['amount', 'paymentamount', 'paid', 'value']],
  ['currency', ['currency', 'ccy', 'paidin']],
  ['paid_at', ['paidat', 'paymentdate', 'date', 'datepaid']],
  ['method', ['method', 'paymentmethod', 'channel']],
  ['pin', ['pin', 'krapin', 'taxpin']],
  ['period', ['period', 'filingperiod', 'reviewperiod']],
  ['filing_type', ['filingtype', 'taxtype']],
  ['filed_at', ['filedat', 'filingdate', 'datefiled']],
  ['lease_ref', ['leaseref', 'leaseid', 'leasecode', 'contractref']],
  ['tenant_name', ['tenantname']],
  ['property_ref', ['propertyref', 'propertyid', 'propertycode']],
  ['end_date', ['enddate', 'expirydate', 'leaseend']],
  ['employee_ref', ['employeeref', 'employeeid', 'staffid']],
  ['score', ['score', 'rating', 'reviewscore']],
  ['reviewer', ['reviewer', 'manager', 'reviewedby']],
]);

const normaliseHeader = (h: string): string =>
  h.toLowerCase().replace(/[^a-z0-9]/g, '');

function bestAttributeFor(
  header: string,
  allowedKeys: ReadonlyArray<string>
): { readonly key: string; readonly score: number } | null {
  const norm = normaliseHeader(header);
  if (norm.length === 0) return null;

  let best: { key: string; score: number } | null = null;
  for (const key of allowedKeys) {
    const patterns = SYNONYMS.get(key);
    if (!patterns) continue;
    let score = 0;
    if (norm === key.replace(/_/g, '')) score = 1.0;
    else if (patterns.includes(norm)) score = 0.95;
    else {
      for (const pat of patterns) {
        if (norm === pat) score = Math.max(score, 0.95);
        else if (norm.includes(pat) || pat.includes(norm)) score = Math.max(score, 0.7);
      }
    }
    if (score > 0 && (best === null || score > best.score)) {
      best = { key, score };
    }
  }
  return best;
}

export interface HeuristicProposalInput {
  readonly schema: InferredSchema;
  readonly availableEntityTypes: ReadonlyArray<EntityTypeDescriptor>;
}

/**
 * Score every (entity_type, column → attribute) candidate and return the
 * best. Confidence is computed as:
 *
 *   sum(per-column-match-score * type_confidence) / num_columns
 *
 * — i.e. high-confidence type AND high-confidence header match both
 * contribute. Type-inference confidence acts as a multiplier so noisy
 * columns can't drag a strong match across the threshold.
 */
export function proposeMappingHeuristic(
  input: HeuristicProposalInput
): EntityMappingProposal {
  const { schema, availableEntityTypes } = input;
  let best: {
    entityType: string;
    fieldMap: Record<string, string>;
    confidence: number;
    conflicts: ProposalConflict[];
  } | null = null;

  // Null-prototype map keyed by source column → attribute key. Using
  // Object.create(null) plus an explicit forbidden-key filter blocks
  // prototype-pollution attempts via malicious column names like
  // "__proto__" or "constructor" coming from a hostile file header.
  const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
  for (const descriptor of availableEntityTypes) {
    const fieldMap: Record<string, string> = Object.assign(
      Object.create(null),
      {}
    ) as Record<string, string>;
    const usedAttrs = new Set<string>();
    let totalScore = 0;
    let scoredCols = 0;
    const conflicts: ProposalConflict[] = [];

    for (const col of schema.columns) {
      if (FORBIDDEN_KEYS.has(col.name)) continue;
      const match = bestAttributeFor(col.name, descriptor.attribute_keys);
      if (match && !usedAttrs.has(match.key)) {
        fieldMap[col.name] = match.key;
        usedAttrs.add(match.key);
        totalScore += match.score * (col.type_confidence > 0 ? col.type_confidence : 0.5);
        scoredCols += 1;
      } else if (match && usedAttrs.has(match.key)) {
        conflicts.push({
          column: col.name,
          reason: `Both ${col.name} and an earlier column matched ${match.key}`,
          severity: 'medium',
        });
      }
    }

    if (scoredCols === 0) continue;

    // Required-attribute coverage check.
    const required = descriptor.required_attribute_keys ?? [];
    const requiredCovered = required.filter((r) => usedAttrs.has(r));
    const requiredCoverage = required.length === 0 ? 1 : requiredCovered.length / required.length;
    if (requiredCoverage < 1) {
      const missing = required.filter((r) => !usedAttrs.has(r));
      for (const m of missing) {
        conflicts.push({
          column: m,
          reason: `Required attribute "${m}" for entity_type "${descriptor.entity_type}" not found in any column`,
          severity: 'high',
        });
      }
    }

    const rawConfidence = totalScore / Math.max(scoredCols, 1);
    // Penalise low required-coverage and unmatched columns (the more
    // columns we couldn't place, the less sure we are about the entity
    // type).
    const coverageRatio = scoredCols / schema.columns.length;
    const confidence = Math.min(
      1,
      rawConfidence * (0.5 + 0.5 * coverageRatio) * (0.5 + 0.5 * requiredCoverage)
    );

    if (best === null || confidence > best.confidence) {
      best = {
        entityType: descriptor.entity_type,
        fieldMap,
        confidence,
        conflicts,
      };
    }
  }

  if (best === null) {
    return {
      entity_type: 'unknown',
      field_map: {},
      confidence: 0,
      llm_rationale:
        'Heuristic mapper found no candidate entity type. LLM proposal required.',
      conflicts: [
        {
          column: '*',
          reason: 'No entity type matched any column',
          severity: 'high',
        },
      ],
    };
  }

  return {
    entity_type: best.entityType,
    field_map: best.fieldMap,
    confidence: Number(best.confidence.toFixed(3)),
    llm_rationale: `Heuristic match against entity_type=${best.entityType} based on header synonyms.`,
    conflicts: best.conflicts,
  };
}
