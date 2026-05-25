'use client';

/**
 * UiArtifact — the Piece-G inline-artifact renderer.
 *
 * Takes a `ui_artifacts` row shape (canonical store), looks up its
 * catalog entry, validates the props + data via Zod, projects to the
 * underlying `AgUiUiPart` shape, then delegates to `AdaptiveRenderer`.
 *
 * Security invariants enforced here:
 *   1. `component_type` MUST be a member of `ARTIFACT_CATALOG`.
 *      Unknown types render a `UnknownKindCard` and do NOT call into
 *      any primitive — the brain can never emit raw JSX/HTML, only
 *      arguments that select a pre-registered component.
 *   2. The artifact's `{props, data}` blob MUST pass the catalog's
 *      Zod schema. A malformed payload renders `UnknownKindCard`
 *      with a structured diagnostic.
 *   3. The projector that maps catalog payload → AgUiUiPart is
 *      EXPLICIT per type — no string interpolation, no eval, no
 *      dangerouslySetInnerHTML.
 *
 * The component is pure: no side-effects, no fetches, no setTimeout.
 * All effects (e.g. chart rerender on theme switch) flow through the
 * tenant brand-theme context.
 */

import { useMemo } from 'react';
import { AdaptiveRenderer } from './AdaptiveRenderer';
import { UnknownKindCard } from './components/UnknownKindCard';
import {
  validateAndRender,
  type ArtifactValidationFailure,
  type UiArtifactRow,
  type ValidateAndRenderResult,
} from './validate-artifact';

// Re-export pure types for React-side consumers.
export {
  validateAndRender,
  type ArtifactValidationFailure,
  type UiArtifactRow,
  type ValidateAndRenderResult,
};

export interface UiArtifactProps {
  readonly artifact: UiArtifactRow;
  /**
   * Telemetry hook fired when a validation or unknown-type fallback
   * occurs. Host portals wire this into their observability pipeline.
   */
  readonly onValidationFailure?: (info: ArtifactValidationFailure) => void;
}

export function UiArtifact({ artifact, onValidationFailure }: UiArtifactProps): JSX.Element {
  const { ok, failure, uiPart } = useMemo(
    () => validateAndRender(artifact),
    [artifact],
  );

  if (!ok || !uiPart) {
    if (failure && onValidationFailure) {
      onValidationFailure(failure);
    }
    return (
      <UnknownKindCard
        kind={`${artifact.componentType} (malformed)`}
        payload={{
          _artifactId: artifact.id,
          _reason: failure?.reason ?? 'unknown',
          _message: failure?.message ?? 'unknown validation failure',
          props: artifact.props,
          data: artifact.data,
        }}
      />
    );
  }

  return (
    <div
      data-testid="ui-artifact"
      data-artifact-id={artifact.id}
      data-component-type={artifact.componentType}
      data-locale={artifact.locale ?? 'en'}
    >
      {artifact.title ? (
        <h3
          data-testid="ui-artifact-title"
          style={{
            margin: '0 0 8px',
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--genui-fg, #0f172a)',
          }}
        >
          {artifact.title}
        </h3>
      ) : null}
      {artifact.description ? (
        <p
          data-testid="ui-artifact-description"
          style={{
            margin: '0 0 8px',
            fontSize: 12,
            color: 'var(--genui-fg-muted, #64748b)',
          }}
        >
          {artifact.description}
        </p>
      ) : null}
      <AdaptiveRenderer uiPart={uiPart} />
    </div>
  );
}
