/**
 * API base-URL resolver for the marketing site.
 *
 * The marketing site is the public surface; outbound writes (buyer
 * signup) go to the api-gateway. In production the gateway is reached
 * via a same-origin proxy and the empty base URL works. In local dev
 * the gateway runs on 127.0.0.1:4001 so a NEXT_PUBLIC_API_GATEWAY_URL
 * override is read instead.
 *
 * We refuse to hard-code a localhost URL so the deploy artefact stays
 * environment-pure — same pattern as owner-web's `OwnerContactStep`.
 */
export function apiBaseUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_API_GATEWAY_URL;
  if (fromEnv && fromEnv.length > 0) {
    return fromEnv.replace(/\/$/, '');
  }
  return '';
}
