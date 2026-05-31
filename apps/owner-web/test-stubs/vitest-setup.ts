/**
 * Global vitest setup for @borjie/owner-web.
 *
 * jsdom does not implement ResizeObserver, which `recharts`
 * (`ResponsiveContainer`) requires at mount. Without this polyfill,
 * components that render any chart inside an effect throw
 * `ReferenceError: ResizeObserver is not defined`, which React then
 * surfaces as an unmount — making outer test assertions (`getByTestId`)
 * fail with a misleading "element not found" error.
 *
 * The polyfill is a no-op observer that satisfies the API surface
 * recharts touches: `observe`, `unobserve`, `disconnect`. Components
 * never receive a resize callback in jsdom, but that matches what they
 * do when their parent has zero layout dimensions anyway.
 */

class ResizeObserverPolyfill {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  // Double-cast through `unknown`: the polyfill is a structural stand-in,
  // not assignable to the real ResizeObserver signature (jsdom has none).
  (
    globalThis as unknown as { ResizeObserver: typeof ResizeObserverPolyfill }
  ).ResizeObserver = ResizeObserverPolyfill;
}
