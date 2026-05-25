/**
 * `lazyImage` — builds the `<picture>` tree for an image with:
 *
 *   - AVIF first (50% smaller than JPEG, 20-30% smaller than WebP)
 *   - WebP fallback (universal modern-browser support)
 *   - JPEG/PNG safety net (legacy + Safari pre-17)
 *   - Native `loading="lazy"` (below-the-fold)
 *   - `decoding="async"` (off the main thread, lower INP)
 *   - LQIP blur-up placeholder via `style.backgroundImage` data URI
 *
 * Returns a pure JSON description of the `<picture>` tree; the React
 * app maps it to JSX. Keeps this package React-free.
 *
 * Source: AVIF 95% global support as of early 2026 (caniuse.com),
 * picture-element pattern recommended by Google Core Web Vitals docs.
 */

export interface LazyImageInput {
  readonly src: string;
  readonly alt: string;
  readonly width?: number;
  readonly height?: number;
  /**
   * Responsive variants — pass a list of widths. The function appends
   * `?w=<width>` query strings so a Sharp-backed image-CDN can serve
   * the right resolution per breakpoint.
   */
  readonly widths?: readonly number[];
  /**
   * `sizes` attribute. Default `'100vw'` — assume full-width unless
   * told otherwise.
   */
  readonly sizes?: string;
  /**
   * Loading priority. `'low'` (default) → loading="lazy" + decoding="async".
   * `'high'` → loading="eager" + fetchPriority="high" (use for LCP image).
   */
  readonly priority?: 'low' | 'high';
  /** Low-quality image placeholder — base64 data URL, blurred. */
  readonly lqip?: string;
  /** Image-CDN base format — `webp` or `avif`. */
  readonly format?: 'avif' | 'webp' | 'auto';
}

export interface PictureSource {
  readonly type: 'image/avif' | 'image/webp' | 'image/jpeg' | 'image/png';
  readonly srcSet: string;
  readonly sizes?: string;
}

export interface LazyImageDescriptor {
  readonly sources: readonly PictureSource[];
  readonly img: {
    readonly src: string;
    readonly alt: string;
    readonly loading: 'lazy' | 'eager';
    readonly decoding: 'async' | 'sync';
    readonly fetchPriority?: 'high' | 'low' | 'auto';
    readonly width?: number;
    readonly height?: number;
    readonly style?: { readonly backgroundImage?: string; readonly backgroundSize?: string };
  };
}

/**
 * Build the descriptor for a responsive `<picture>` tree.
 *
 *   const desc = lazyImage({ src: '/hero.jpg', alt: 'Hero', widths: [640, 1280, 1920] });
 *   // Renders:
 *   //   <picture>
 *   //     <source type="image/avif" srcset="/hero.jpg?w=640&fmt=avif 640w, …" />
 *   //     <source type="image/webp" srcset="/hero.jpg?w=640&fmt=webp 640w, …" />
 *   //     <img src="/hero.jpg" loading="lazy" decoding="async" />
 *   //   </picture>
 */
export function lazyImage(input: LazyImageInput): LazyImageDescriptor {
  const widths = input.widths ?? [640, 960, 1280, 1920];
  const sizes = input.sizes ?? '100vw';
  const priority = input.priority ?? 'low';
  const isHigh = priority === 'high';

  const buildSrcSet = (fmt: 'avif' | 'webp' | null): string =>
    widths
      .map((w) => {
        const sep = input.src.includes('?') ? '&' : '?';
        const fmtParam = fmt ? `&fmt=${fmt}` : '';
        return `${input.src}${sep}w=${w}${fmtParam} ${w}w`;
      })
      .join(', ');

  const sources: PictureSource[] = [
    { type: 'image/avif', srcSet: buildSrcSet('avif'), sizes },
    { type: 'image/webp', srcSet: buildSrcSet('webp'), sizes },
  ];

  const styleObj =
    input.lqip !== undefined
      ? {
          style: {
            backgroundImage: `url('${input.lqip}')`,
            backgroundSize: 'cover',
          },
        }
      : {};

  return {
    sources,
    img: {
      src: input.src,
      alt: input.alt,
      loading: isHigh ? ('eager' as const) : ('lazy' as const),
      decoding: 'async' as const,
      ...(isHigh ? { fetchPriority: 'high' as const } : {}),
      ...(input.width !== undefined ? { width: input.width } : {}),
      ...(input.height !== undefined ? { height: input.height } : {}),
      ...styleObj,
    },
  };
}
