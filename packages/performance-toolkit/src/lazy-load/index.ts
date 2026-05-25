/**
 * Lazy-load barrel — primitives for route + component + image lazy.
 */

export { loaderWithRetry, wrapAsLazy, getDefaultWindowAdapter } from './lazy-with-retry.js';
export type { ReactLazyShape } from './lazy-with-retry.js';

export {
  prefetchOnHover,
  prefetchManyOnHover,
  insertResourceHint,
} from './prefetch-on-hover.js';
export type { PrefetchHandlers } from './prefetch-on-hover.js';

export { createIntersectionLazy } from './use-intersection-lazy.js';
export type {
  IntersectionLazyOptions,
  IntersectionLazyController,
} from './use-intersection-lazy.js';

export { lazyImage } from './lazy-image.js';
export type {
  LazyImageInput,
  LazyImageDescriptor,
  PictureSource,
} from './lazy-image.js';

export {
  preloadOnHover,
  preloadManyOnHover,
} from './preload-on-hover.js';
export type { PreloadHandlers } from './preload-on-hover.js';
