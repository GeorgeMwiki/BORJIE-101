# @borjie/error-catalog

The shared **CODE → { en, sw }** gateway-error catalog and the
`localizeApiError` helper. One source of truth so all four client apps
(owner-web, admin-web, workforce-mobile, buyer-mobile) and gateway/services
render localized, user-safe error copy in the active locale — and never leak a
raw English wire `error.message` under `sw` (that would be language mixing,
which the Borjie language canon forbids absolutely).

## Usage

```ts
import { localizeApiError } from "@borjie/error-catalog";

// err can be an ApiError-like { code, message }, a bare { code }, or a raw code string.
const text = localizeApiError(err, locale); // locale: "en" | "sw"
```

Resolution:

- known user-reachable 4xx code → its localized copy
- unknown code / 5xx-infra / miss → the single generic localized fallback

`localizeApiError` NEVER returns a raw English `error.message`.

## Gate

`pnpm --filter @borjie/error-catalog test` runs the parity + coverage ratchet:

- every entry has non-empty `en` AND `sw` (complete parity)
- no accidental `sw === en` passthrough on a translatable code
- every gateway-emitted user-reachable 4xx code is either localized or in the
  shrink-only `generic-by-design` allowlist

The gateway code fixtures under `src/__fixtures__/` are generated from
`services/api-gateway/src/routes/**`.
