/**
 * Pure (no-React, no-DOM) validator + projector entry point.
 *
 * `UiArtifact.tsx` re-exports these from React-land so consumers in
 * portal apps can pick whichever surface they need. Server-side code
 * (api-gateway, jobs, brain) imports from here to stay leaflet- and
 * react-pdf-free.
 */

import {
  ARTIFACT_CATALOG_BY_KEY,
  type ArtifactComponentType,
} from './catalog';
import { projectArtifactToUiPart } from './projector';
import type { AgUiUiPart } from './types';

/**
 * Canonical shape — matches `ui_artifacts` row in
 * `packages/database/src/migrations/0205_ui_artifacts.sql`. All
 * timestamps are ISO-8601 on the wire.
 */
export interface UiArtifactRow {
  readonly id: string;
  readonly tenantId: string;
  readonly threadId?: string | null;
  readonly createdByUserId?: string | null;
  readonly componentType: string;
  readonly props: Readonly<Record<string, unknown>>;
  readonly data: Readonly<Record<string, unknown>>;
  readonly version: number;
  readonly parentVersionId?: string | null;
  readonly title?: string | null;
  readonly description?: string | null;
  readonly locale?: 'en' | 'sw';
  readonly themeTokenSetId?: string | null;
  readonly createdAt: string;
}

export interface ArtifactValidationFailure {
  readonly artifactId: string;
  readonly componentType: string;
  readonly reason: 'unknown-type' | 'schema-validation-failed';
  readonly message: string;
}

export interface ValidateAndRenderResult {
  readonly ok: boolean;
  readonly failure: ArtifactValidationFailure | null;
  readonly uiPart: AgUiUiPart | null;
}

export function validateAndRender(
  artifact: UiArtifactRow,
): ValidateAndRenderResult {
  const componentType = artifact.componentType;
  const catalogEntry =
    ARTIFACT_CATALOG_BY_KEY[componentType as ArtifactComponentType];

  if (!catalogEntry) {
    return {
      ok: false,
      failure: {
        artifactId: artifact.id,
        componentType,
        reason: 'unknown-type',
        message: `component_type "${componentType}" is not in the catalog`,
      },
      uiPart: null,
    };
  }

  const parsed = catalogEntry.schema.safeParse({
    component_type: componentType,
    props: artifact.props,
    data: artifact.data,
  });

  if (!parsed.success) {
    return {
      ok: false,
      failure: {
        artifactId: artifact.id,
        componentType,
        reason: 'schema-validation-failed',
        message: parsed.error.issues
          .slice(0, 5)
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; '),
      },
      uiPart: null,
    };
  }

  const uiPart = projectArtifactToUiPart(
    componentType as ArtifactComponentType,
    artifact.props,
    artifact.data,
  );

  if (!uiPart) {
    return {
      ok: false,
      failure: {
        artifactId: artifact.id,
        componentType,
        reason: 'schema-validation-failed',
        message: `projector returned null for component_type "${componentType}"`,
      },
      uiPart: null,
    };
  }

  return { ok: true, failure: null, uiPart };
}
