/**
 * <GeofenceDesigner/> — sidebar UI for designing a geofence: pick the
 * polygon from already-traced parcels, label it, set a buffer in
 * metres, and a color.
 *
 * Spec: `.audit/sota-2026-05-24/01-geo-platform.md` §6.
 *
 * Like ParcelPaintingPanel this is a controlled, presentation-only
 * component. The parent owns the engine and persistence.
 */

import { useId, useState } from 'react';
import type { GeoFence, GeoJsonPolygon } from '../types.js';

export interface GeofenceDesignerProps {
  readonly polygon: GeoJsonPolygon | null;
  readonly initialLabel?: string;
  readonly initialBufferM?: number;
  readonly initialColor?: string;
  readonly disabled?: boolean;
  readonly onSave: (fence: Omit<GeoFence, 'id'>) => void;
  readonly onCancel?: () => void;
  readonly className?: string;
}

const COLOR_OPTIONS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6'];

export function GeofenceDesigner(props: GeofenceDesignerProps): JSX.Element {
  const labelId = useId();
  const bufferId = useId();
  const colorId = useId();
  const [label, setLabel] = useState<string>(props.initialLabel ?? '');
  const [bufferM, setBufferM] = useState<number>(props.initialBufferM ?? 0);
  const [color, setColor] = useState<string>(props.initialColor ?? COLOR_OPTIONS[0]!);

  const canSave = !!props.polygon && label.trim().length > 0 && !props.disabled;

  return (
    <aside
      className={props.className}
      data-testid="geo-platform-geofence-designer"
      aria-label="Geofence designer"
    >
      <header>
        <h2>Design geofence</h2>
        {!props.polygon ? (
          <p>Trace a polygon first, then return here to label it.</p>
        ) : (
          <p>Set a label, optional buffer, and color.</p>
        )}
      </header>

      <div>
        <label htmlFor={labelId}>Label</label>
        <input
          id={labelId}
          type="text"
          value={label}
          maxLength={120}
          disabled={props.disabled}
          onChange={(e): void => setLabel(e.target.value)}
        />
      </div>

      <div>
        <label htmlFor={bufferId}>Buffer (m)</label>
        <input
          id={bufferId}
          type="number"
          min={0}
          max={500}
          step={1}
          value={bufferM}
          disabled={props.disabled}
          onChange={(e): void => {
            const v = Number(e.target.value);
            setBufferM(Number.isFinite(v) && v >= 0 ? v : 0);
          }}
        />
      </div>

      <fieldset>
        <legend>Color</legend>
        {COLOR_OPTIONS.map((c) => (
          <label key={c}>
            <input
              type="radio"
              name={colorId}
              value={c}
              checked={color === c}
              disabled={props.disabled}
              onChange={(): void => setColor(c)}
            />
            <span aria-hidden style={{ display: 'inline-block', width: 16, height: 16, background: c }} />
          </label>
        ))}
      </fieldset>

      <div>
        <button
          type="button"
          disabled={!canSave}
          onClick={(): void => {
            if (!props.polygon) return;
            props.onSave({
              label: label.trim(),
              polygon: props.polygon,
              bufferM,
              color,
            });
          }}
        >
          Save geofence
        </button>
        {props.onCancel ? (
          <button type="button" disabled={props.disabled} onClick={props.onCancel}>
            Cancel
          </button>
        ) : null}
      </div>
    </aside>
  );
}
