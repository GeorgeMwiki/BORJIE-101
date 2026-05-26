/**
 * Minimal ambient declaration for `plyr` — the upstream package ships
 * its own types but we lazy-import it at runtime only and want
 * `pnpm typecheck` to pass before the install side-effect runs. The
 * full type surface is not needed by ReportPlayer; we type the ctor
 * as `unknown` and rely on a local structural interface in the
 * component for the bits we actually call (`destroy`).
 */
declare module 'plyr' {
  const Plyr: new (
    element: HTMLElement,
    options?: unknown,
  ) => { readonly destroy?: () => void };
  export default Plyr;
}
