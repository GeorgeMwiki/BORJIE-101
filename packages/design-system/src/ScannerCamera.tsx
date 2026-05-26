/**
 * ScannerCamera — Document scanning UI component (NEW 14)
 *
 * Provides a camera viewfinder with live edge-detection overlay, multi-page
 * capture, re-take, and bundle-submit. Native camera + edge detection hooks
 * are stubbed under KI-015; the React surface is production-shaped.
 *
 * Expected integrations (stubbed for this pass):
 *   - useMediaStream()        → getUserMedia wrapper
 *   - useEdgeDetection()      → WASM OpenCV or native module; returns quad
 *   - useDeskew()             → perspective-correct the page using the quad
 *
 * Callers provide `onBundleSubmit` with the array of captured pages.
 */

import * as React from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScannedPage {
  readonly id: string;
  /** Data URL (base64 PNG) of the final (deskewed) page. */
  readonly dataUrl: string;
  /** Optional 4 quad corners in the source frame — for audit/rework. */
  readonly quad?: readonly { x: number; y: number }[];
  readonly capturedAt: string;
}

export interface ScannerCameraProps {
  readonly onBundleSubmit: (pages: readonly ScannedPage[]) => void | Promise<void>;
  readonly onCancel?: () => void;
  readonly maxPages?: number;
  readonly facingMode?: 'environment' | 'user';
  /** Optional localization hook (Swahili/English). */
  readonly labels?: {
    readonly capture?: string;
    readonly retake?: string;
    readonly done?: string;
    readonly cancel?: string;
    readonly pageCount?: (n: number) => string;
  };
}

// ---------------------------------------------------------------------------
// Stub hooks — replace with real implementations
// ---------------------------------------------------------------------------

// Follow-up KI-015 (#33): implement with navigator.mediaDevices.getUserMedia —
//   see Docs/KNOWN_ISSUES.md#ki-015.
function useMediaStream(_facingMode: 'environment' | 'user'): {
  stream: MediaStream | null;
  error: string | null;
} {
  return { stream: null, error: null };
}

// Follow-up KI-015 (#33): wire to WASM OpenCV / native edge detector —
//   see Docs/KNOWN_ISSUES.md#ki-015.
function useEdgeDetection(_videoRef: React.RefObject<HTMLVideoElement>): {
  quad: readonly { x: number; y: number }[] | null;
} {
  return { quad: null };
}

// Follow-up KI-015 (#33): implement perspective-correct crop using the detected
//   quad — see Docs/KNOWN_ISSUES.md#ki-015.
function deskewFrame(
  _video: HTMLVideoElement,
  _quad: readonly { x: number; y: number }[] | null
): string {
  // Placeholder — returns empty data URL.
  return 'data:image/png;base64,';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ScannerCamera(props: ScannerCameraProps): JSX.Element {
  const { onBundleSubmit, onCancel, maxPages = 20, facingMode = 'environment', labels } = props;

  const videoRef = React.useRef<HTMLVideoElement>(null);
  const { stream, error } = useMediaStream(facingMode);
  const { quad } = useEdgeDetection(videoRef);
  const [pages, setPages] = React.useState<readonly ScannedPage[]>([]);

  React.useEffect(() => {
    const video = videoRef.current;
    if (video && stream) {
      video.srcObject = stream;
    }
  }, [stream]);

  const handleCapture = React.useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (pages.length >= maxPages) return;

    const dataUrl = deskewFrame(video, quad);
    const next: ScannedPage = {
      id: `page_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      dataUrl,
      quad: quad ?? undefined,
      capturedAt: new Date().toISOString(),
    };
    setPages((prev) => [...prev, next]);
  }, [pages.length, maxPages, quad]);

  const handleRetake = React.useCallback(() => {
    setPages((prev) => prev.slice(0, -1));
  }, []);

  const handleDone = React.useCallback(async () => {
    await onBundleSubmit(pages);
  }, [onBundleSubmit, pages]);

  if (error) {
    return (
      <div role="alert" className="scanner-camera scanner-camera--error">
        Camera unavailable: {error}
      </div>
    );
  }

  const captureLabel = labels?.capture ?? 'Capture';
  const retakeLabel = labels?.retake ?? 'Retake';
  const doneLabel = labels?.done ?? 'Done';
  const cancelLabel = labels?.cancel ?? 'Cancel';
  const pageCountLabel = labels?.pageCount ?? ((n: number) => `${n} page(s)`);

  return (
    <div className="scanner-camera" role="region" aria-label="Document scanner">
      <div className="scanner-camera__viewport">
        <video ref={videoRef} autoPlay playsInline muted />
        {/* Follow-up KI-015 (#33): render the detected quad as an SVG overlay. */}
        {quad ? (
          <svg className="scanner-camera__quad" aria-hidden="true" />
        ) : null}
      </div>

      <div className="scanner-camera__controls">
        <button type="button" onClick={handleCapture} disabled={pages.length >= maxPages}>
          {captureLabel}
        </button>
        <button type="button" onClick={handleRetake} disabled={pages.length === 0}>
          {retakeLabel}
        </button>
        <button type="button" onClick={handleDone} disabled={pages.length === 0}>
          {doneLabel}
        </button>
        {onCancel ? (
          <button type="button" onClick={onCancel}>
            {cancelLabel}
          </button>
        ) : null}
      </div>

      <div className="scanner-camera__meta" aria-live="polite">
        {pageCountLabel(pages.length)}
      </div>
    </div>
  );
}

export default ScannerCamera;
