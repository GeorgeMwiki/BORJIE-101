/**
 * Raw-error-render baseline allowlist (Class A — see `raw-error-render.ts`).
 *
 * A shrink-only ratchet of source files that STILL render a raw gateway
 * error `.message` into a user-facing surface. The gate
 * (`__tests__/raw-error-render.test.ts`) fails when:
 *   - a NEW leak appears that is not on this list (regression), or
 *   - a file ON this list no longer leaks (stale entry → delete it).
 *
 * The round-11 sweep drove every owner-web error render through
 * `localizeApiError(err, locale)` / a stable error CODE. Round-12b WIDENED
 * the scanner (bare-JSX render · `instanceof Error ? .message : <localised>`
 * · user-facing state-field property) and converted the whole newly-visible
 * user-facing offender set (Ask/HomeChat inline, Licence, PlanBilling,
 * sign-in, jurisdiction, personal-kb, document-intelligence, RfbDispatch,
 * WorkforceTabRequestQueue, GenUIFieldRenderer, the genui-tab resolvers, the
 * document upload/explorer).
 *
 * ONE residual entry remains:
 *   - `lib/cockpit-sse.ts` — the widened state-field pattern flags the
 *     `setState({ … error: err instanceof Error ? err.message : … })` in the
 *     EventSource-construct catch. This `error` field is INTERNAL connection
 *     state: no cockpit consumer (CockpitLivePulse, NotificationsInbox)
 *     RENDERS it — it gates reconnect, never paints a string — so it is a
 *     false-positive for the USER-FACING class, not a live mix. The file is
 *     owned by another work-stream this round; the entry is parked here so
 *     the gate stays green and SHRINKS the moment that store stops carrying a
 *     raw `.message` (or the field is proven render-dead and the pattern
 *     refined). It is the safe direction, per the scanner's deliberate
 *     breadth — never a place to park a genuinely user-rendered leak.
 */
export const RAW_ERROR_RENDER_ALLOWLIST: readonly string[] = [
  'lib/cockpit-sse.ts',
];
