/**
 * R19 — page deskew utility.
 *
 * Pure-TS deskew implementation. Operates on the 4-corner quad
 * the mobile scanner already emits (see `scan_bundle_pages.quad`)
 * and computes the rotation angle that maps the longest edge to
 * horizontal.
 *
 * The actual pixel transform happens on the device — this server-side
 * helper only computes the angle so the device can avoid sending an
 * already-aligned page through the transformation pass twice. It is
 * additive over the existing scanner: if `quad` is null OR the
 * computed angle is below the threshold (default 0.5°), we return
 * `null` and the caller skips deskew.
 *
 * Output angle is in DEGREES, positive = counter-clockwise (matches
 * the `Image.rotate` convention used by `react-native-image-resizer`).
 */

export interface QuadPoint {
  readonly x: number;
  readonly y: number;
}

export interface QuadCorners {
  /** Top-left, top-right, bottom-right, bottom-left in canvas pixels. */
  readonly tl: QuadPoint;
  readonly tr: QuadPoint;
  readonly br: QuadPoint;
  readonly bl: QuadPoint;
}

const RAD_TO_DEG = 180 / Math.PI;

/**
 * Compute the deskew angle in DEGREES from a 4-corner quad. Returns
 * `null` when:
 *   - the quad is null / undefined,
 *   - all 4 corners collapse to the same point (degenerate scan),
 *   - the computed angle is below `minDegrees`.
 *
 * Uses the LONGEST top edge (tl→tr) as the reference; that's the edge
 * the scanner is most confident about because it's the side closest to
 * the camera horizon.
 */
export function computeDeskewAngle(
  quad: QuadCorners | null | undefined,
  minDegrees = 0.5,
): number | null {
  if (!quad) return null;
  const dx = quad.tr.x - quad.tl.x;
  const dy = quad.tr.y - quad.tl.y;
  if (dx === 0 && dy === 0) return null;
  const angleRad = Math.atan2(dy, dx);
  const angleDeg = angleRad * RAD_TO_DEG;
  if (Math.abs(angleDeg) < minDegrees) return null;
  // Negative because positive Y goes DOWN in canvas; positive deskew
  // angle should rotate counter-clockwise to bring the top edge back
  // to horizontal.
  return -angleDeg;
}

/**
 * Result of running the deskew step for a single page.
 */
export interface DeskewResult {
  readonly pageNumber: number;
  readonly angleDeg: number | null;
  readonly skipped: boolean;
}

/**
 * Pure batch helper — computes the deskew decision for an array of
 * pages. The caller (worker / route) applies the actual rotation on
 * the storage object; this function only orchestrates the decision.
 */
export function decideDeskewForPages(
  pages: ReadonlyArray<{
    pageNumber: number;
    quad?: QuadCorners | null;
  }>,
  minDegrees = 0.5,
): DeskewResult[] {
  return pages.map((p) => {
    const angle = computeDeskewAngle(p.quad ?? null, minDegrees);
    return {
      pageNumber: p.pageNumber,
      angleDeg: angle,
      skipped: angle === null,
    };
  });
}
