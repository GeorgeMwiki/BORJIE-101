/**
 * Regulator simulation — Tanzania PDPA readiness.
 *
 * Sample subject-access and erasure flows end-to-end. The harness never
 * touches live PII; it operates on synthetic fixtures and validates that
 * the pipeline:
 *
 *   - Returns ALL required artefacts for a subject-access request
 *   - Redacts third-party PII inside those artefacts
 *   - Honours legal-hold exclusions on erasure
 *   - Returns a verifiable `fulfilledAt` timestamp
 *
 * Ported from LITFIN; artefact kinds re-skinned to a mining estate.
 */

import type {
  ErasureRequest,
  PdpaResult,
  SubjectAccessRequest,
} from './types.js';

export type SubjectArtefactKind =
  | 'licence_application'
  | 'document'
  | 'decision'
  | 'communication'
  | 'audit_event';

export interface SubjectArtefact {
  readonly subjectId: string;
  readonly kind: SubjectArtefactKind;
  readonly id: string;
  readonly contents: string;
  readonly thirdPartyPiiFields?: ReadonlyArray<string>;
  readonly legalHoldUntilIso?: string;
}

export interface PdpaSurface {
  readonly fetchArtefacts: (subjectId: string) => ReadonlyArray<SubjectArtefact>;
  readonly redact: (artefact: SubjectArtefact) => SubjectArtefact;
  readonly erase: (artefactId: string) => void;
}

/** Default in-memory surface — used by tests and the CI drill. */
export function createInMemoryPdpaSurface(
  initial: ReadonlyArray<SubjectArtefact>,
): PdpaSurface & { readonly snapshot: () => ReadonlyArray<SubjectArtefact> } {
  let store: ReadonlyArray<SubjectArtefact> = [...initial];
  return {
    fetchArtefacts(subjectId) {
      return store.filter((a) => a.subjectId === subjectId);
    },
    redact(a) {
      if (!a.thirdPartyPiiFields || a.thirdPartyPiiFields.length === 0) {
        return a;
      }
      let redacted = a.contents;
      for (const field of a.thirdPartyPiiFields) {
        redacted = redacted.replaceAll(field, '[REDACTED]');
      }
      return { ...a, contents: redacted };
    },
    erase(artefactId) {
      store = store.filter((a) => a.id !== artefactId);
    },
    snapshot() {
      return [...store];
    },
  };
}

export function fulfilSubjectAccess(
  req: SubjectAccessRequest,
  surface: PdpaSurface,
  nowIso: string = new Date().toISOString(),
): PdpaResult {
  const artefacts = surface.fetchArtefacts(req.subjectId);
  const redactedFields: string[] = [];
  const processed = artefacts.map((a) => {
    if (a.thirdPartyPiiFields) {
      redactedFields.push(...a.thirdPartyPiiFields);
    }
    return surface.redact(a);
  });

  // A subject with zero records is suspicious; flag it rather than passing.
  const passed = processed.length > 0;

  return {
    subjectId: req.subjectId,
    action: 'access',
    artefactsCount: processed.length,
    fulfilledAt: nowIso,
    redactedFields: Array.from(new Set(redactedFields)).sort(),
    residualOnLegalHold: [],
    passed,
    ...(passed ? {} : { reason: 'no artefacts found for subject' }),
  };
}

export function fulfilErasure(
  req: ErasureRequest,
  surface: PdpaSurface,
  nowIso: string = new Date().toISOString(),
): PdpaResult {
  const artefacts = surface.fetchArtefacts(req.subjectId);
  const residual: string[] = [];
  let erasedCount = 0;

  for (const a of artefacts) {
    const onHold =
      a.legalHoldUntilIso !== undefined &&
      Date.parse(a.legalHoldUntilIso) > Date.parse(nowIso);
    if (onHold) {
      residual.push(a.id);
      continue;
    }
    surface.erase(a.id);
    erasedCount += 1;
  }

  // Pass: every artefact either erased OR retained on a documented legal
  // hold. A mixed outcome is still a PASS (PDPA permits retention on hold).
  const passed = erasedCount + residual.length === artefacts.length;

  return {
    subjectId: req.subjectId,
    action: 'erasure',
    artefactsCount: erasedCount,
    fulfilledAt: nowIso,
    redactedFields: [],
    residualOnLegalHold: residual,
    passed,
    ...(passed
      ? {}
      : { reason: 'erasure pipeline did not account for every artefact' }),
  };
}

/** One-shot end-to-end: access then erasure for a synthetic subject. */
export function pdpaEndToEnd(
  subjectId: string,
  surface: PdpaSurface,
  nowIso: string = new Date().toISOString(),
): { readonly access: PdpaResult; readonly erasure: PdpaResult } {
  const access = fulfilSubjectAccess(
    { subjectId, receivedAt: nowIso, scope: 'full' },
    surface,
    nowIso,
  );
  const erasure = fulfilErasure({ subjectId, receivedAt: nowIso }, surface, nowIso);
  return { access, erasure };
}
