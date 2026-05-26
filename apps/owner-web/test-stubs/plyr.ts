/**
 * Vitest stub for the `plyr` package. The owner-web tests do not
 * exercise Plyr — the player falls back to the native <audio>
 * element when Plyr fails to mount, and that is the surface the
 * tests assert against. This stub satisfies vite's static
 * `import('plyr')` analysis without an actual install.
 */
export default class PlyrStub {
  constructor(public readonly element: HTMLElement) {}
  destroy(): void {
    /* no-op */
  }
}
