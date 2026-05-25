/**
 * PROV-O binding — every node / edge can carry a `derivedFrom`
 * `ProvenanceRecord` that ties the fact back to its source.
 *
 * Recognised activity kinds:
 *   - `ingest`  — raw data load from a system of record
 *   - `extract` — pulled from an unstructured doc (OCR / NER)
 *   - `infer`   — produced by an LLM or classifier
 *   - `merge`   — entity-resolution merge of two prior facts
 *   - `manual_edit` — a human operator edited the value
 *   - `import`  — bulk import from external KG
 *
 * Optional bindings:
 *   - `c2paSignatureId` — links the fact to a C2PA-signed source
 *     document from `packages/document-studio/c2pa/`.
 *   - `aiModelId` — the model name + version that inferred it.
 *   - `citationBundleId` — an Anthropic Citations bundle ID so the
 *     fact's narrative source can be displayed inline.
 *
 * Reference: W3C PROV-O (https://www.w3.org/TR/prov-o/).
 */

import type { Edge, Node, ProvenanceRecord } from '../types.js';
import { ProvenanceRecordSchema } from '../types.js';

export function attachProvenance<T extends Node | Edge>(
  item: T,
  prov: ProvenanceRecord,
): T {
  // immutable update
  return { ...item, derivedFrom: prov };
}

export function hasProvenance(item: Node | Edge): boolean {
  return item.derivedFrom !== undefined;
}

export interface ProvenanceValidation {
  readonly valid: boolean;
  /** Items missing `derivedFrom`. */
  readonly missingIds: ReadonlyArray<string>;
  /** Items with malformed prov records (zod validation errors). */
  readonly malformedIds: ReadonlyArray<string>;
}

export function validateProvenance(args: {
  readonly nodes: ReadonlyArray<Node>;
  readonly edges: ReadonlyArray<Edge>;
  /** When true, missing prov is an error. Default false. */
  readonly strict?: boolean;
}): ProvenanceValidation {
  const missing: string[] = [];
  const malformed: string[] = [];

  const check = (item: Node | Edge): void => {
    if (!item.derivedFrom) {
      if (args.strict) missing.push(item.id);
      return;
    }
    const parsed = ProvenanceRecordSchema.safeParse(item.derivedFrom);
    if (!parsed.success) malformed.push(item.id);
  };

  for (const n of args.nodes) check(n);
  for (const e of args.edges) check(e);

  return {
    valid: missing.length === 0 && malformed.length === 0,
    missingIds: missing,
    malformedIds: malformed,
  };
}
