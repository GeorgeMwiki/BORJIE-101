# @borjie/cli

The `borjie` command-line interface — chat with Mr. Mwikila, manage
drafts, reminders, estate, compliance, decisions, and more. Built for
agents (Claude Code, Cursor, Windsurf, custom MCP clients) as well as
humans.

## Install

```sh
npm install -g @borjie/cli
```

Requires Node 20+. Also runs on Bun and Deno without modification (the
CLI uses `globalThis.fetch` only).

## Quick start

```sh
borjie login          # OAuth2 device-flow sign-in
borjie whoami         # show identity + scopes + api base
borjie chat "Nichambulie hali ya leseni yangu" --language sw
borjie drafts ls
borjie drafts new --intent "draft a renewal letter for ML-12345"
borjie drafts lock <id> --reason "finalized"
borjie reminders add "renew PCCB" --when 2026-06-15T08:00:00Z
borjie estate sites
borjie compliance check
borjie scope
borjie opportunities
borjie risks
borjie decisions ls
borjie share draft <id>
borjie logout
```

## Authentication

`borjie login` initiates the OAuth2 device authorization grant
(RFC 8628):

1. The CLI requests a device code and user code from
   `POST /api/v1/oauth/device/code`.
2. It opens a browser to `https://owner.borjie.app/oauth/confirm?code=...`
   (override with `--no-browser` and copy/paste).
3. You approve or deny the requested scopes in the owner cockpit.
4. The CLI polls `POST /api/v1/oauth/token` until you approve, then
   stores the access token in `~/.config/borjie/credentials.json` (file
   mode 0600).

To revoke: `borjie logout`, or visit
`/settings/connected-agents` in the owner cockpit.

## Output modes

- `--json` — emit machine-readable JSON only. All informational logging
  is suppressed; errors still print to stderr.
- `--no-color` — strip ANSI escape codes.
- `--verbose` — print debug-level events to stderr.

JSON mode is the right choice for agent pipelines:

```sh
borjie --json drafts ls | jq '.data[].id'
borjie --json chat "what's expiring this week?" | jq -r 'select(.event=="message_chunk").data.text' | tr -d '\n'
```

## Configuration

| Env var                  | Default                     | Meaning                                          |
| ------------------------ | --------------------------- | ------------------------------------------------ |
| `BORJIE_API_BASE_URL`    | `https://api.borjie.app`    | Override the api-gateway base URL.               |
| `BORJIE_CREDENTIALS_FILE`| `~/.config/borjie/credentials.json` | Override the credentials path (for tests). |

Per-command overrides:

```sh
borjie login --api https://api-staging.borjie.app \
             --client-id my-bot \
             --client-label "Marketing bot" \
             --scope owner:read --scope owner:draft
```

## Commands

| Command                              | Purpose                                              |
| ------------------------------------ | ---------------------------------------------------- |
| `login`                              | OAuth2 device-flow sign-in                            |
| `logout`                             | Revoke token + remove credentials                     |
| `whoami`                             | Print current identity + scopes                       |
| `chat "<prompt>"`                    | SSE-stream a teaching response from the brain         |
| `tabs ls` / `tabs open <id>`         | Owner cockpit tab inventory                           |
| `reminders ls` / `reminders add`     | Reminders                                             |
| `drafts ls` / `drafts new` / `drafts lock` / `drafts show` | Document drafts             |
| `estate sites` / `estate workers`    | Mining estate roll-ups                                |
| `compliance check`                   | Compliance status summary                             |
| `scope`                              | Scope taxonomy + selected nodes                       |
| `opportunities`                      | Active opportunities                                  |
| `risks`                              | Active risks                                          |
| `decisions ls` / `decisions show <id>` | Decision journal                                    |
| `share <entityType> <id>`            | Generate a share link                                 |

## Bilingual (sw / en)

The CLI prompts in English; the brain responds in the language you
request (`--language sw` or `--language en`). The default is Swahili
because Borjie is Swahili-first (see `CLAUDE.md`).

## License

MIT
