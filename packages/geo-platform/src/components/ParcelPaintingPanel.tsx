/**
 * <ParcelPaintingPanel/> — sidebar UI for tracing a parcel boundary
 * and dropping elements onto walls / garages / fences.
 *
 * Spec: `.audit/sota-2026-05-24/01-geo-platform.md` §5, §7.
 *
 * This is a pure controlled component: it receives the in-flight
 * polygon + element list from the parent and emits change callbacks.
 * Map interaction (click → vertex push) is wired by the parent via
 * `<LiveMap onMapClick=...>`.
 */

import { useCallback } from 'react';
import type { GeoJsonPoint, GeoJsonPolygon, Position } from '../types.js';

export type ElementKind =
  | 'wall'
  | 'fence'
  | 'gate'
  | 'garage'
  | 'door'
  | 'window'
  | 'meter'
  | 'tap'
  | 'pole'
  | 'other';

export interface ParcelElement {
  readonly id: string;
  readonly kind: ElementKind;
  readonly point: GeoJsonPoint;
  readonly label?: string;
}

export interface ParcelPaintingPanelProps {
  readonly polygon: GeoJsonPolygon | null;
  readonly elements: readonly ParcelElement[];
  readonly onPolygonChange: (next: GeoJsonPolygon | null) => void;
  readonly onAddElement: (kind: ElementKind) => void;
  readonly onRemoveElement: (id: string) => void;
  readonly onClear?: () => void;
  /** Disable interactions (e.g. while saving). */
  readonly disabled?: boolean;
  readonly className?: string;
}

const KIND_LABELS: Record<ElementKind, string> = {
  wall: 'Wall',
  fence: 'Fence',
  gate: 'Gate',
  garage: 'Garage',
  door: 'Door',
  window: 'Window',
  meter: 'Meter',
  tap: 'Water tap',
  pole: 'Pole',
  other: 'Other',
};

export function ParcelPaintingPanel(props: ParcelPaintingPanelProps): JSX.Element {
  const { polygon, elements, disabled } = props;
  const vertexCount = polygon?.coordinates[0]?.length ?? 0;

  const handleUndoVertex = useCallback((): void => {
    if (!polygon) return;
    const outer = polygon.coordinates[0] ?? [];
    if (outer.length === 0) {
      props.onPolygonChange(null);
      return;
    }
    const trimmed = outer.slice(0, -1) as readonly Position[];
    if (trimmed.length < 3) {
      props.onPolygonChange(null);
      return;
    }
    props.onPolygonChange({
      type: 'Polygon',
      coordinates: [trimmed, ...polygon.coordinates.slice(1)],
    });
  }, [polygon, props]);

  return (
    <aside
      className={props.className}
      data-testid="geo-platform-parcel-painting-panel"
      aria-label="Parcel painting panel"
    >
      <header>
        <h2>Paint parcel</h2>
        <p>
          {vertexCount === 0
            ? 'Click on the map to start tracing your boundary.'
            : `${vertexCount} vertex point${vertexCount === 1 ? '' : 's'} placed.`}
        </p>
      </header>

      <section aria-label="Polygon actions">
        <button type="button" disabled={disabled || vertexCount === 0} onClick={handleUndoVertex}>
          Undo last point
        </button>
        <button
          type="button"
          disabled={disabled || vertexCount === 0}
          onClick={(): void => {
            if (props.onClear) props.onClear();
            else props.onPolygonChange(null);
          }}
        >
          Clear boundary
        </button>
      </section>

      <section aria-label="Add element">
        <h3>Drop element</h3>
        <ul>
          {Object.entries(KIND_LABELS).map(([kind, label]) => (
            <li key={kind}>
              <button
                type="button"
                disabled={disabled}
                onClick={(): void => props.onAddElement(kind as ElementKind)}
              >
                + {label}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Placed elements">
        <h3>Placed ({elements.length})</h3>
        {elements.length === 0 ? (
          <p>No elements yet.</p>
        ) : (
          <ul>
            {elements.map((el) => (
              <li key={el.id}>
                <span>{el.label ?? KIND_LABELS[el.kind]}</span>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={(): void => props.onRemoveElement(el.id)}
                  aria-label={`Remove ${el.label ?? KIND_LABELS[el.kind]}`}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}
