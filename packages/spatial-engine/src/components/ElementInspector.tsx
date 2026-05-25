/**
 * <ElementInspector/> — right-rail editor for a selected parcel element.
 *
 * Renders read + minimal write surfaces for a single `Element` (a wall,
 * fence, garage, gate, etc.) selected from the `<ParcelMap/>`. Presentational
 * only — the host application owns persistence, permissions, validation.
 *
 * Color stripe matches `colorForStatus(element.status)` so the inspector
 * visually reinforces the same encoding the map uses.
 */

'use client';

import * as React from 'react';
import type { Element, ElementPhoto, MapLayer } from '../types.js';
import { colorForStatus } from '../color-coding.js';

export interface ElementInspectorProps {
  /** The currently-selected element (null = no selection, panel collapses). */
  readonly element: Element | null;
  /** Map layers available for re-classification of the element. */
  readonly availableLayers: ReadonlyArray<MapLayer>;
  /** Photos attached to this element (already permission-checked by host). */
  readonly photos?: ReadonlyArray<ElementPhoto>;
  /** The current layer id the element is rendered under (host-tracked). */
  readonly currentLayerId?: string;
  /** Fired when the user re-classifies the element to a different layer. */
  readonly onChangeLayer?: (elementId: string, newLayerId: string) => void;
  /** Fired when the user edits a metadata key. */
  readonly onChangeMetadata?: (elementId: string, key: string, value: string) => void;
  /** Fired when the user opts to upload a photo (file picker is host-owned). */
  readonly onRequestPhotoUpload?: (elementId: string) => void;
  /**
   * Optional time-series renderer — when present, the inspector renders
   * the host-supplied component beneath the metadata panel.
   */
  readonly TimelineSlot?: React.ComponentType<{ readonly elementId: string }>;
}

export function ElementInspector(props: ElementInspectorProps): React.ReactElement | null {
  const {
    element,
    availableLayers,
    photos,
    currentLayerId,
    onChangeLayer,
    onChangeMetadata,
    onRequestPhotoUpload,
    TimelineSlot,
  } = props;
  if (!element) return null;

  const stripeColor = colorForStatus(element.status);
  const metadataEntries = Object.entries(element.metadata ?? {});
  const labelFromMetadata = typeof element.metadata?.label === 'string' ? element.metadata.label : null;
  const headerLabel = labelFromMetadata ?? `${element.elementType} · ${element.id.slice(0, 8)}`;

  return (
    <aside
      data-testid="element-inspector"
      style={{
        borderLeft: `4px solid ${stripeColor}`,
        padding: '12px 16px',
        background: 'var(--surface, #fafafa)',
        height: '100%',
        overflowY: 'auto',
        fontFamily: 'inherit',
      }}
    >
      <header style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{headerLabel}</h2>
        <p style={{ margin: '2px 0 0 0', fontSize: 12, opacity: 0.7 }}>
          {element.elementType} · <span style={{ color: stripeColor }}>{element.status}</span> · {element.condition}
        </p>
      </header>

      {availableLayers.length > 0 && (
        <section aria-label="layer reclassification" style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>Layer</label>
          <select
            value={currentLayerId ?? availableLayers.find((l) => l.isDefault)?.id ?? availableLayers[0]!.id}
            onChange={(e) => onChangeLayer?.(element.id, e.currentTarget.value)}
            disabled={!onChangeLayer}
            style={{ width: '100%', padding: '6px 8px', fontSize: 13 }}
          >
            {availableLayers.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </section>
      )}

      {metadataEntries.length > 0 && (
        <section aria-label="metadata" style={{ marginBottom: 12 }}>
          <h3 style={{ fontSize: 13, fontWeight: 600, margin: '0 0 4px 0' }}>Metadata</h3>
          <dl style={{ margin: 0 }}>
            {metadataEntries.map(([k, v]) => (
              <div key={k} style={{ display: 'flex', gap: 8, fontSize: 12, padding: '2px 0' }}>
                <dt style={{ flex: '0 0 40%', opacity: 0.7 }}>{k}</dt>
                <dd style={{ flex: 1, margin: 0 }}>
                  {onChangeMetadata ? (
                    <input
                      type="text"
                      defaultValue={String(v ?? '')}
                      onBlur={(e) => onChangeMetadata(element.id, k, e.currentTarget.value)}
                      style={{ width: '100%', fontSize: 12 }}
                    />
                  ) : (
                    String(v ?? '')
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <section aria-label="photos" style={{ marginBottom: 12 }}>
        <header
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 4,
          }}
        >
          <h3 style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>Photos</h3>
          {onRequestPhotoUpload && (
            <button
              type="button"
              onClick={() => onRequestPhotoUpload(element.id)}
              style={{ fontSize: 11, padding: '2px 8px' }}
            >
              Upload
            </button>
          )}
        </header>
        {photos && photos.length > 0 ? (
          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 4,
            }}
          >
            {photos.map((p) => (
              <li key={p.id}>
                <img
                  src={p.storageUrl}
                  alt={`photo ${p.id}`}
                  loading="lazy"
                  style={{
                    width: '100%',
                    height: 60,
                    objectFit: 'cover',
                    borderRadius: 4,
                  }}
                />
              </li>
            ))}
          </ul>
        ) : (
          <p style={{ fontSize: 12, opacity: 0.6, margin: 0 }}>No photos attached.</p>
        )}
      </section>

      {TimelineSlot && (
        <section aria-label="timeline">
          <h3 style={{ fontSize: 13, fontWeight: 600, margin: '0 0 4px 0' }}>History</h3>
          <TimelineSlot elementId={element.id} />
        </section>
      )}
    </aside>
  );
}
