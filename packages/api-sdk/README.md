# @borjie/api-sdk

Typed HTTP SDK for the Borjie Gateway API. Types are auto-generated from
`Docs/api/openapi.generated.json` via `openapi-typescript`. The hand-written
client wrapper layers in auth, timeouts, URL building, and structured errors.

## Install (inside the monorepo)

```ts
import { createBossnyumbaClient, ApiSdkError } from '@borjie/api-sdk';

const client = createBossnyumbaClient({
  baseUrl: 'http://localhost:4001',
  // Static token OR a function that refreshes the JWT on each call.
  bearerToken: async () => getAccessToken(),
  timeoutMs: 10_000,
});

try {
  const listings = await client.marketplace.listings.list({ page: 1, limit: 20 });
  console.log(listings);
} catch (err) {
  if (err instanceof ApiSdkError) {
    console.error(`gateway said ${err.code} @ ${err.status}: ${err.message}`);
  }
}
```

## Regenerating types

Run after any OpenAPI change (the `openapi-drift` CI workflow enforces this):

```bash
pnpm -C packages/api-sdk generate
pnpm -C packages/api-sdk build
```

## Error handling

All non-2xx responses throw `ApiSdkError` which carries `status`, `code`,
`requestId` (if the gateway emits one), and any `details` payload.

## Typed brain-tool clients

The SDK ships a typed wrapper per brain-tool category so external
agents discover the surface via autocomplete:

```ts
import {
  createBorjieClient,
  createBrainTools,
  RateLimitError,
  AuthError,
} from '@borjie/api-sdk';

const client = createBorjieClient({
  baseUrl: 'https://api.borjie.app',
  bearerToken: process.env.BORJIE_TOKEN,
});

const tools = createBrainTools(client);

try {
  const drafts = await tools.drafts.list();
  await tools.reminders.add({
    text: 'renew PCCB',
    fireAt: '2026-06-15T08:00:00Z',
    idempotencyKey: crypto.randomUUID(),
  });
  for await (const frame of tools.chat.teach({ prompt: 'hali ya leseni', language: 'sw' })) {
    if (frame.event === 'message_chunk') {
      const { text } = JSON.parse(frame.data);
      process.stdout.write(text);
    }
  }
} catch (err) {
  if (err instanceof RateLimitError) {
    console.warn(`back off ${err.retryAfterSec ?? '?'}s`);
  } else if (err instanceof AuthError) {
    console.error('token expired or invalid; re-authenticate');
  } else {
    throw err;
  }
}
```

Categories exposed by `createBrainTools()`:

`chat`, `drafts`, `estate`, `compliance`, `opportunities`, `risks`,
`decisions`, `entities`, `reminders`, `share`, `bulk`, `undo`, `scope`.

## Runtime support

The SDK uses `globalThis.fetch` and `ReadableStream` only — it runs on:

| Runtime  | Status   | Notes                                      |
| -------- | -------- | ------------------------------------------ |
| Node 20+ | full     | uses built-in fetch                         |
| Bun      | full     | uses Bun's fetch                            |
| Deno     | full     | uses Deno's fetch                           |
| Browser  | full     | bundle with esbuild / vite — no polyfill   |

```ts
// Bun:
import { createBorjieClient, createBrainTools } from '@borjie/api-sdk';
const tools = createBrainTools(createBorjieClient({ baseUrl: '...' }));

// Deno (no install — use the npm specifier):
import { createBorjieClient, createBrainTools } from 'npm:@borjie/api-sdk';

// Browser (Vite):
import { createBorjieClient, createBrainTools } from '@borjie/api-sdk';
```

## Retry helper

The SDK includes an exponential-backoff `retry()` helper used internally
by the brain-tool wrappers. You can wrap your own calls too:

```ts
import { retry } from '@borjie/api-sdk';

const result = await retry(() => doFlakyThing(), {
  attempts: 5,
  delaysMs: [100, 400, 1600, 6400, 25600],
});
```

The default schedule is 3 attempts (200 ms, 800 ms, 3200 ms) and retries
on 0, 408, 425, 429, 500, 502, 503, 504, and `NETWORK_ERROR`.

## Typed error hierarchy

Every brain-tool method throws a `BorjieError` subclass so callers can
switch on `instanceof` instead of inspecting status codes:

- `AuthError`        — 401 / 403
- `ValidationError`  — 400, carries `issues[]`
- `RateLimitError`   — 429, carries `retryAfterSec`
- `ServerError`      — 5xx
- `NetworkError`     — fetch threw (timeout, DNS, etc.)

`ApiSdkError` (the legacy class) is still exported for backwards
compatibility.

## Not included

- No React hooks — use `@borjie/api-client` for React-specific helpers.
