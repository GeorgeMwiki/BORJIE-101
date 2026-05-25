# Timezone Detection & Per-User TZ Rendering: SOTA Research

**Date:** 2026-05-25
**Owner:** BORJIE platform team
**Status:** Implemented — `packages/timezone-detection/`

## Why this matters

Borjie operates across multiple jurisdictions (TZ/KE/UG/RW/NG/ZA today, EU + Americas tomorrow). A property-management tenant in Lagos sees rent reminders at 09:00 WAT; the same tenant's auditor in London needs the same timestamp rendered at 10:00 BST. If we treat the database row's ISO instant as a literal "time of day" instead of a UTC instant, we ship the wrong reminder to the wrong continent.

This package centralises **detection** (which TZ does this request belong to?) and **rendering** (how do we display a UTC instant for the user we're serving?). It is the timestamp equivalent of `formatCurrency(amount, currencyCode)`: no business logic ever hard-codes a TZ.

## Goals

1. Single composite priority chain — account > JWT claim > browser > IP > jurisdiction > UTC.
2. Zero new runtime dependencies — Node 20+ ships IANA `tzdata 2024b+` via `Intl`.
3. Africa-first jurisdiction defaults (54 sovereign states) with sane ROW coverage.
4. Correct DST edge-case handling (spring-forward gap, fall-back overlap).
5. Hono + Fastify middleware so api-gateway wires it once and downstream handlers see `c.get('tz')` / `req.tz`.

## SOTA detection mechanisms (researched)

### 1. `Intl.DateTimeFormat().resolvedOptions().timeZone` — browser native

The canonical 2026 approach. Supported by every evergreen browser since Chrome 24 / Firefox 52 / Safari 10, and Node 20+. The legacy `jstz` library is no longer needed because every browser now exposes the timezone directly.

Sources:
- MDN, *Intl.DateTimeFormat.prototype.resolvedOptions()*: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat/resolvedOptions
- ECMA-402 spec, *Intl.DateTimeFormat*: https://tc39.es/ecma402/#sec-intl.datetimeformat
- HTML Living Standard, *Time zones in browser*: https://html.spec.whatwg.org/multipage/system-state.html#dom-navigator-language
- TC39 *Temporal API* status: https://github.com/tc39/proposal-temporal (Stage 3 as of 2025; replaces Date)

### 2. IANA Time Zone Database (tzdata 2024b+)

The authoritative source of historical + future DST rules for every region on Earth. Updated quarterly. Node 20+ embeds the full database via ICU; no separate ship.

Sources:
- IANA Time Zone Database: https://www.iana.org/time-zones
- *tzdata 2024b changelog*: https://data.iana.org/time-zones/tzdb/NEWS
- *Theory and pragmatics of the tz code and data*: https://data.iana.org/time-zones/tzdb/theory.html
- Eggert & Olson, *Sources for time zone and daylight saving time data*: https://data.iana.org/time-zones/tz-link.html

### 3. JWT `zoneinfo` claim (RFC 7519 §5.1)

The OpenID Connect Core 1.0 spec registers `zoneinfo` as a standard string claim whose value SHOULD be an IANA TZ id. Auth0, Okta, AWS Cognito, Keycloak and Supabase all emit it when the user profile has a TZ set. **Highest single-source confidence (1.0)** because the user explicitly authenticated to obtain the token.

Sources:
- RFC 7519, *JSON Web Token*, §5.1: https://datatracker.ietf.org/doc/html/rfc7519#section-5
- OpenID Connect Core 1.0, *Standard Claims*: https://openid.net/specs/openid-connect-core-1_0.html#StandardClaims
- Auth0, *zoneinfo claim usage*: https://auth0.com/docs/secure/tokens/json-web-tokens
- AWS Cognito, *Standard attribute zoneinfo*: https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-attributes.html

### 4. GeoIP-to-TZ (MaxMind, ipapi.co, ipgeolocation.io)

Reasonable fallback when no other signal exists. Unreliable in absolute terms (mobile carriers, corporate VPNs, Tor, Starlink) — we score it 0.7 confidence and prefer browser/account.

Sources:
- MaxMind GeoIP2 binary `.mmdb`: https://dev.maxmind.com/geoip/geoip2/downloadable
- ipapi.co free-tier docs: https://ipapi.co/api/
- ipgeolocation.io timezone endpoint: https://ipgeolocation.io/documentation/timezone-api.html
- Twilio engineering, *Account-zone best practice*: https://www.twilio.com/docs/messaging/best-practices/timezone-handling
- ip-api.com (alternative): https://ip-api.com/docs

### 5. Jurisdiction default (per-country capital-city TZ)

Last-mile fallback. We ship 54 African ISO-3166-1 alpha-2 codes + ~120 ROW. Multi-zone countries (US, CA, RU, BR, AU, MX, CN-de-facto-single, KZ, ES, PT) carry an `isMultiZone: true` flag so callers can downrank the result and prefer browser/IP.

Sources:
- ISO 3166-1 alpha-2 country codes: https://www.iso.org/iso-3166-country-codes.html
- Wikipedia, *List of time zones by country*: https://en.wikipedia.org/wiki/List_of_time_zones_by_country
- CIA *World Factbook*, time zone field: https://www.cia.gov/the-world-factbook/field/standard-time-zones/

### 6. Mobile-native APIs

For the customer + estate-manager native apps when we ship them:
- Android: `TimeZone.getDefault()` — returns an IANA id.
- iOS: `NSTimeZone.localTimeZone` — returns an IANA id via `name` property.

Sources:
- Android Developers, `TimeZone.getDefault()`: https://developer.android.com/reference/java/util/TimeZone#getDefault()
- Apple Developer, `NSTimeZone.localTimeZone`: https://developer.apple.com/documentation/foundation/nstimezone/1387196-localtimezone

## DST edge-case handling

### Spring-forward (missing wall-clock hour)

The clock jumps 02:00 -> 03:00 local. Any cron-style "fire at 02:30 daily" entry MUST be rescheduled to either 01:30 (earlier) or 03:30 (later), never silently skipped. Our `safeAddDays(date, 1, tz)` keeps anchored to the original wall-clock hour and the offset shift is absorbed transparently.

### Fall-back (duplicated wall-clock hour)

The clock falls 02:00 -> 01:00 local. 01:30 happens twice — once with the still-active offset, once with the new offset. `resolveAmbiguousHour(date, tz, prefer)` lets callers pick `earlier` (still-DST) or `later` (already-standard-time) deterministically.

Sources:
- Date.js / Luxon, *DST handling*: https://moment.github.io/luxon/#/zones
- Microsoft engineering, *Avoiding DST bugs*: https://learn.microsoft.com/en-us/dotnet/standard/datetime/converting-between-time-zones
- *Falsehoods programmers believe about time*: https://infiniteundo.com/post/25326999628/falsehoods-programmers-believe-about-time

## Why not Luxon / date-fns-tz?

We evaluated both:

- **Luxon** — excellent ergonomics, but pulls 100KB+ and duplicates the same `Intl` data that's already in V8.
- **date-fns-tz** — smaller, but tree-shakability is brittle in pnpm workspaces.
- **Temporal API polyfill** — Stage 3, ship a polyfill before browsers/Node ship native? Risky. Wait for native.

Our package uses raw `Intl.DateTimeFormat` + `Intl.RelativeTimeFormat` directly. Result: **0 runtime dependencies**, lockfile-friendly.

## Twilio's account-zone best practice

Twilio's official guidance:
1. Detect TZ once at sign-up.
2. Persist on the user/account record.
3. Re-derive ONLY when the user changes their location (browser ships a different `Intl` value).
4. Server-side rendering should NEVER call `Intl.DateTimeFormat()` without a `timeZone:` argument — that returns the SERVER's tz, which is wrong by definition.

We follow all four rules.

## Performance characteristics

- `Intl.DateTimeFormat` constructor is expensive (~1ms). We cache per-`timeZone`.
- `partsInZone(date, tz)` reuses the cached formatter — ~5µs per call.
- `detectComposite()` for the happy path (account TZ present) is O(1) and synchronous up to the GeoIP step.
- `nextOccurrence()` walks at most 366×2 calendar days; for normal "0 9 * * *" cron entries it returns within 1ms.

## What's wired downstream

Composition-root usage in `services/api-gateway/src/index.ts`:

```ts
import { createTimezoneDetection } from '@borjie/timezone-detection';

const tzd = createTimezoneDetection({
  // wire MaxMind / ipapi / ipgeolocation adapter here in prod
});
app.use('*', tzd.middleware.hono());
// downstream: const tz = c.get('tz');  // -> "Africa/Nairobi"
```

Every reminder, statement, dashboard widget and audit-log entry that renders a time MUST go through one of:
- `tzd.render.renderInTZ(date, tz, 'yyyy-MM-dd HH:mm ZZ')`
- `tzd.render.humanReadable(date, { tz, locale })`
- `tzd.render.relativeTime(date, { tz })`

Direct `date.toISOString()` is acceptable only for serialisation to the wire.

## Test coverage

111 tests pass in ~600ms:

- 6 detect/* suites — validate, browser, ip, jwt, jurisdiction, composite
- 1 jurisdiction-defaults suite — 54 African + ROW coverage + DST flags
- 1 dst-handling suite — offset, transitions, ambiguous, safe arithmetic
- 1 render suite — renderInTZ, relativeTime, nextOccurrence, humanReadable
- 1 middleware suite — extractTimezone, Hono, Fastify
- 1 composition-root suite — `createTimezoneDetection()`

DST transitions are covered for:
- spring-forward: `America/New_York` 2026-03-08, `Europe/London` 2026-03-29
- fall-back: `America/New_York` 2026-11-01, `Europe/London` 2026-10-25
- Africa/Nairobi: never reports a transition (confirms the no-DST flag)

## Open questions / follow-ups

1. Should we surface a `confidence` warning when the composite resolver picks `jurisdiction` for a multi-zone country (US/CA/RU/BR/AU)? Today we just lower the score to 0.2.
2. The `nextOccurrence()` cron parser is intentionally minimal — no range, no name. If product needs full-strength cron, swap in `croner` at composition time (no API change).
3. We do not currently fold the `locale` claim from RFC 7519 into the render context — apps still pass `locale` explicitly. Worth wiring later.
