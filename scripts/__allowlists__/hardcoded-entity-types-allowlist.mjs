/**
 * Hardcoded-entity-types allow-list (Piece P).
 *
 * The `entity_type_definition` lookup table + polymorphic dispatch are
 * the canonical way to branch on entity shape (PROPERTY / UNIT / LEASE
 * / INVOICE / etc.). String-equal-comparing against a literal in
 * business logic defeats that seam.
 *
 * Auto-allowlisted (NOT a violation):
 *   - Test / fixture / mock / story files.
 *   - Zod schema declarations / type unions / enum keys.
 *   - The domain-models package (it IS the entity-type registry).
 *
 * Explicit allow-list:
 *   Files that legitimately switch-dispatch on entity_type (mappers,
 *   renderers, document-type → icon switches). Every entry carries an
 *   ≥ 8-character justification.
 */

export const HARDCODED_ENTITY_TYPES_ALLOWLIST = new Map([
  // ─── Domain-models package: entity-type registry ──────────────────
  [
    'packages/domain-models/src/common/enums.ts',
    'EntityType enum object {PROPERTY, UNIT, LEASE, INVOICE, ...} IS the canonical entity-type registry.',
  ],

  // ─── Document-type icon / formatter switches (UI presentation) ────
  [
    'apps/owner-portal/src/pages/DocumentsPage.tsx',
    'DocumentsPage maps document type to emoji icon; this IS the document-type → icon presentation table.',
  ],
  [
    'apps/owner-portal/src/pages/documents/ESignature.tsx',
    'ESignature page renders type-specific signature-flow header; presentation-level dispatch on doc type.',
  ],
  [
    'apps/owner-portal/src/pages/ComplianceDocumentsPage.tsx',
    'ComplianceDocumentsPage COMPLIANCE_TYPES array IS the compliance-document-type registry for upload UI.',
  ],

  // ─── Document upload routes (entity-type dispatch tables) ────────
  [
    'services/api-gateway/src/routes/documents.hono.ts',
    'documents.hono.ts implements the document-entity-type dispatch table (LEASE → PROPERTY → ...).',
  ],
  [
    'services/api-gateway/src/types/mock-types.ts',
    'mock-types.ts is the demo-mode entity-type literal registry used by the seed/sandbox bootstrap path.',
  ],
  [
    'services/api-gateway/src/routes/properties.ts',
    'properties.ts uses PROPERTY literal as the entity-code namespace prefix for generated short codes.',
  ],

  // ─── Spotlight role-routing (entity-type vs role-type literal) ───
  [
    'apps/customer-app/src/components/SpotlightMount.tsx',
    'SpotlightMount declares userRoles=[TENANT] as the customer-app role-binding; this IS the role-mount config.',
  ],
]);
