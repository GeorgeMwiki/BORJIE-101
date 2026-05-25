# Inngest — local dev setup

`@borjie/central-intelligence` wraps the legacy `TaskAgentExecutor`
in an Inngest durable function so multi-step agent flows survive
crashes. For local development we run the Inngest CLI dev server —
no cloud account, no signing keys, no event keys.

## Start the dev server

One-liner:

```bash
npx inngest-cli@latest dev
```

This binds the dev server to `http://localhost:8288`. Open
`http://localhost:8288` in a browser for the dashboard (runs, events,
function registrations).

## Wire the kernel client

Either set the env var and call the factory bare:

```ts
import { createLocalDevInngestClient } from '@borjie/central-intelligence/durable';

// In your shell:
//   export INNGEST_DEV=1
const client = createLocalDevInngestClient();
```

Or pass `enabled: true` explicitly (skips the env read):

```ts
const client = createLocalDevInngestClient({
  enabled: true,
  appId: 'parcel-service',
  baseUrl: 'http://localhost:8288',
});
```

When `INNGEST_DEV` is unset and `enabled` is `false`, the factory
returns a no-op client — every `send()` is a silent drop. This keeps
boot-time code paths identical between dev and prod.

## Env vars

| Var               | Default                  | Effect                                              |
|-------------------|--------------------------|-----------------------------------------------------|
| `INNGEST_DEV`     | _(unset)_                | `1`/`true`/`yes`/`on` enables the real dev client.  |
| `INNGEST_DEV_URL` | `http://localhost:8288`  | Override the CLI base URL (rare; only on port clash). |

## Production vs. dev

- **Prod**: `createInngestComposition({ clientFactory: () => new Inngest({...}) })`
  with `INNGEST_EVENT_KEY` + `INNGEST_SIGNING_KEY` and
  `DURABLE_EXEC_ENABLED=true`.
- **Local dev**: `createLocalDevInngestClient()` + the CLI above. No
  keys needed — the CLI accepts anything as the event-key path.

Both factories return the same `InngestClientLike` shape so callers
swap them at the composition root without changing function code.
