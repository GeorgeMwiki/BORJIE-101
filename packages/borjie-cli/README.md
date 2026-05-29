# @borjie/cli

The `borjie` command-line interface — drive your entire Borjie estate
from the terminal as fluently as `gh` drives GitHub or `aider` drives a
codebase. Built for agents (Claude Code, Cursor, Windsurf, custom MCP
clients) **and** humans, with an interactive REPL, autonomous agent
loop, watch daemon, multi-profile credentials, plugin system, shell
completions, and a polished TUI.

## Install

```sh
npm install -g @borjie/cli
```

Requires Node 20+. Also runs on Bun and Deno without modification (the
CLI uses `globalThis.fetch` only).

## Quick start

```sh
borjie                        # interactive REPL (no args)
borjie login                  # OAuth2 device-flow sign-in
borjie whoami                 # show identity + scopes + api base
borjie chat "Nichambulie hali ya leseni yangu" --language sw
borjie chat - < prompt.txt    # read prompt from stdin
borjie agent run "renew all licenses expiring in <30d" --auto-approve
borjie watch --filter opportunities,risks
borjie diff --since 7d --until now
borjie use staging            # switch profile
borjie sessions ls            # list active brain sessions
borjie completion zsh > "${fpath[1]}/_borjie"
```

## The 14 SOTA upgrades

| #  | Upgrade                  | Verb / Behavior                                                                   |
| -- | ------------------------ | --------------------------------------------------------------------------------- |
| 1  | Interactive REPL         | `borjie` (no args) — slash commands `/help /exit /login /whoami /lang /json …`    |
| 2  | Streaming chat           | typing indicator → dim in-progress tokens → normal color on `done`                |
| 3  | Shell completions        | `borjie completion bash\|zsh\|fish` — dynamic entity-id completion via `__complete` |
| 4  | Update notifier          | one-line banner if newer version on npm; 24h cache; `BORJIE_DISABLE_UPDATE_CHECK` |
| 5  | Config file              | `~/.config/borjie/config.toml` — `borjie config show/get/set/path`               |
| 6  | Profile switching        | `borjie use <name>`, `borjie profiles ls/rm` — per-environment apiUrl + token     |
| 7  | Plugin system            | `@borjie-plugin/*` / `borjie-plugin-*` packages auto-discovered; see `PLUGIN_DEV` |
| 8  | Autonomous agent loop    | `borjie agent run <task>` — plan → tool → result → loop, full trace recorded      |
| 9  | Watch daemon             | `borjie watch` — SSE notifications, `--filter`, `--exec`, long-poll fallback     |
| 10 | Estate diff              | `borjie diff <since> [until]` — colorised human or `--json` envelope             |
| 11 | Stdin pipe support       | every command accepts `-` for stdin args (`echo q \| borjie chat -`)              |
| 12 | Output modes             | `--json` envelopes, `--verbose` HTTP traces, `--quiet`, `--no-color`, `NO_COLOR` |
| 13 | Pretty error messages    | summary / why / next-step / request_id, per-class hints (auth / 429 / network)    |
| 14 | Multi-session            | `borjie sessions ls/show/resume/archive/new` — local persistence + server-pass    |

## Interactive REPL (§1)

```sh
$ borjie
Borjie REPL — type a question, /help for commands, /exit to leave.
[default sw]> nichambulie hali ya leseni
…streamed response from Mr. Mwikila…
[default sw]> /lang en
Language switched to en.
[default en]> /json
JSON mode on.
```

Built-in slash commands: `/help /exit /clear /login /whoami /tabs
/scope /lang sw|en /json`. History (one prompt per line) is appended
to `~/.config/borjie/history` and reachable via the up-arrow.

## Streaming chat with typing indicator (§2)

`borjie chat "…"` shows a gray `…` until the first SSE `message_chunk`
arrives, then renders in-progress tokens dimmed; on the `done` event
the cursor moves to a fresh line. JSON mode bypasses cosmetic state
and prints one JSON object per event.

## Shell completions (§3)

```sh
borjie completion bash  > /etc/bash_completion.d/borjie
borjie completion zsh   > "${fpath[1]}/_borjie"
borjie completion fish  > ~/.config/fish/completions/borjie.fish
```

Dynamic completion (e.g. `borjie drafts show <TAB>` → recent draft
ids; `borjie use <TAB>` → profile names) is provided by the hidden
`__complete` subcommand that every shell script calls.

## Update notifier (§4)

After any invocation the CLI fetches `npm view @borjie/cli version`
no more than once per 24h, caches it in
`~/.config/borjie/update-check.json`, and prints a one-line banner if
a newer version is available. Disable with:

```sh
export BORJIE_DISABLE_UPDATE_CHECK=1
# or persist:
borjie config set updateCheckEnabled false
```

## Config file (§5)

```toml
# ~/.config/borjie/config.toml
[defaults]
lang = "sw"
output_format = "text"
color = true
verbose = false
profile = "default"
api_url_override = ""

[update_check]
enabled = true
```

```sh
borjie config show
borjie config path
borjie config get lang
borjie config set lang en
borjie config set outputFormat json
```

## Profiles (§6)

Each profile is a self-contained `{accessToken, apiUrl, clientId,
clientLabel, scopes}` blob under
`~/.config/borjie/profiles/<name>.json` (mode 0600).

```sh
borjie login --profile staging --api https://api-staging.borjie.app
borjie login --profile prod    --api https://api.borjie.app
borjie use staging
borjie profiles ls
# NAME      API URL                          ISSUED AT             ACTIVE
# default   https://api.borjie.app           2026-05-29T08:00:00Z
# staging   https://api-staging.borjie.app   2026-05-29T08:01:00Z  *
borjie --profile prod drafts ls   # one-off override (env: BORJIE_PROFILE)
```

## Plugins (§7)

```sh
borjie plugin install @borjie-plugin/mining-reports
borjie plugin ls
borjie plugin remove @borjie-plugin/mining-reports
```

Authoring guide → [`PLUGIN_DEV.md`](./PLUGIN_DEV.md).

## Autonomous agent loop (§8)

```sh
borjie agent run "renew every license expiring in <30d" --max-steps 20 --auto-approve
borjie agent run "draft an LOI for buyer A" --max-steps 5
# Approve MEDIUM step: drafts.new {"intent":"draft LOI for buyer A"} ? [y/N]
```

Every step (with input/output tokens, latency, result/error) is
appended to `~/.config/borjie/agent-runs/<runId>.jsonl`. Low-risk
tools (read-only) auto-approve; medium / high tools prompt
interactively. `--auto-approve` waives all prompts.

## Watch daemon (§9)

```sh
borjie watch
borjie watch --filter opportunities,risks,reminders
borjie watch --exec 'osascript -e "display notification \"$BORJIE_EVENT_TITLE\""'
borjie --json watch | jq -r '.event'
```

Subscribes to `/api/v1/agent/notifications` (SSE); falls back to
long-poll `/api/v1/agent/notifications/poll` if the SSE channel is
unavailable. Ctrl+C exits cleanly.

## Estate diff (§10)

```sh
borjie diff --since 7d
borjie diff --since 2026-05-01 --until 2026-05-15
borjie --json diff --since 24h | jq '.data.drafts'
```

Outputs a per-bucket added/removed/modified summary in human form
(colorised) or as a JSON envelope.

## Stdin pipe support (§11)

```sh
echo "what's expiring this week?" | borjie chat -
cat prompt.md | borjie chat - --language en
borjie drafts new --intent - < intent.txt
borjie agent run - < big-task.md
```

Any argument literally equal to `-` is replaced with stdin. Honors
`BORJIE_STDIN_TIMEOUT_MS` (default 30s).

## Output modes (§12)

| Flag         | Effect                                                                                        |
| ------------ | --------------------------------------------------------------------------------------------- |
| `--json`     | machine output — every command emits `{ok, data?, error?}` envelopes; no spinners; no banners |
| `--verbose`  | logs every HTTP request/response (method, URL, status, latency_ms, request_id) to stderr     |
| `--quiet`    | suppress informational output, only the result                                                |
| `--no-color` | disable ANSI color                                                                            |
| `NO_COLOR=1` | same as `--no-color` (standard env)                                                          |

## Pretty error messages (§13)

```text
error: Your session is invalid or has expired.
why:   The API returned 401 Unauthorized on /api/v1/owner/drafts.
next:  Run: borjie login
request_id: req_abc123
```

Per-kind hints:

- `auth` (401) → run `borjie login`
- `forbidden` (403) → request the right scopes
- `rate_limit` (429) → extracts `retry_after` and prints `Retry in 12s`
- `network` → check connection or `BORJIE_API_URL`
- `validation` (400 / 422) → re-run with `--verbose` for the issues array
- `server` (5xx) → retry; share `request_id` with support

In JSON mode the same fields are emitted as `{ok:false, error:{...}}`.

## Multi-session (§14)

```sh
borjie sessions ls
borjie sessions new --title "license renewal sprint"
borjie sessions show <id>
borjie sessions resume <id>           # or omit id for most recent
borjie sessions archive <id>
borjie chat "next step?" --session <id>
borjie chat "next step?" --continue   # most recent
```

Sessions are persisted locally at `~/.config/borjie/sessions/` so the
CLI stays useful offline.

## Authentication

`borjie login` initiates the OAuth2 device authorization grant
(RFC 8628):

1. The CLI requests a device code from `POST /api/v1/oauth/device/code`.
2. It opens a browser to `/oauth/confirm?code=...` (override with
   `--no-browser` and copy/paste).
3. You approve or deny the requested scopes in the owner cockpit.
4. The CLI polls `POST /api/v1/oauth/token` until you approve, then
   stores the access token in the active profile under
   `~/.config/borjie/profiles/<name>.json` (file mode 0600).

To revoke: `borjie logout`, or visit
`/settings/connected-agents` in the owner cockpit.

## Configuration env vars

| Env var                       | Default                              | Meaning                                                |
| ----------------------------- | ------------------------------------ | ------------------------------------------------------ |
| `BORJIE_API_BASE_URL`         | `https://api.borjie.app`             | Override the api-gateway base URL for `borjie login`.  |
| `BORJIE_CREDENTIALS_FILE`     | `~/.config/borjie/credentials.json`  | Override the legacy credentials path (tests).          |
| `BORJIE_HOME`                 | `~/.config/borjie`                   | Override the root directory for everything (tests).    |
| `BORJIE_CONFIG_FILE`          | `~/.config/borjie/config.toml`       | Override the config.toml path.                          |
| `BORJIE_PROFILE`              | (active profile from config.toml)    | One-shot override of the active profile.               |
| `BORJIE_DISABLE_UPDATE_CHECK` | unset                                | Disable the npm version check.                          |
| `BORJIE_STDIN_TIMEOUT_MS`     | `30000`                              | Cap on `chat -` / `agent run -` stdin reads.            |
| `NO_COLOR`                    | unset                                | Standard env to disable ANSI color.                     |

## Full command catalog

```
borjie [options] [command]

Global options:
  --json                     machine-readable output (envelope mode)
  --no-color / NO_COLOR=1    disable ANSI color
  --verbose                  HTTP traces + stacks to stderr
  --quiet                    only the result
  --profile <name>           one-shot profile override

Auth & identity:
  login [--api <url>] [--client-id <id>] [--client-label <s>]
        [--scope <s>...] [--no-browser] [--profile <name>]
  logout
  whoami

Conversation:
  chat <prompt|-> [--language sw|en] [--session <id>] [--continue]
  sessions ls [--all]
  sessions show <id>
  sessions resume [id]
  sessions archive <id>
  sessions new [--title <s>] [--language sw|en]

Estate:
  estate sites
  estate workers
  diff [--since <ts|24h>] [--until <ts>]
  watch [--filter <list>] [--exec <cmd>]
  opportunities
  risks
  decisions ls
  decisions show <id>
  compliance check
  scope

Documents:
  drafts ls
  drafts new [--intent <text|->] [--template <slug>]
  drafts lock <id> [--reason <text>]
  drafts show <id>
  reminders ls
  reminders add <text> --when <iso>
  tabs ls
  tabs open <id>
  share <entityType> <id>

Agentic automation:
  agent run <task|-> [--max-steps N] [--auto-approve]

Profiles & config:
  profiles ls
  profiles rm <name>
  use <name>
  config show
  config path
  config get <key>
  config set <key> <value>

Plugins:
  plugin ls
  plugin install <name>
  plugin remove <name>

Shell integration:
  completion <bash|zsh|fish>
```

## Cross-runtime (Node / Bun / Deno)

The CLI imports zero Node-only HTTP libraries. It uses
`globalThis.fetch`, `node:readline/promises`, `node:fs`, `node:os`,
`node:path`, `node:child_process` (for `borjie plugin install` /
`borjie watch --exec`). All other modules are Web-platform.

```sh
node packages/borjie-cli/dist/cli.js --help
bun  packages/borjie-cli/dist/cli.js --help
deno run --allow-all packages/borjie-cli/dist/cli.js --help
```

## Bilingual (sw / en)

Default user language is Swahili (`sw`) because Borjie is
Swahili-first. Toggle via `--language en`, `/lang en` (REPL), or
`borjie config set lang en`.

## License

MIT
