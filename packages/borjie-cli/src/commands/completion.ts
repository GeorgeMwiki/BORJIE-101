/**
 * `borjie completion bash|zsh|fish` — emit a completion script for
 * the requested shell. The script is statically generated from the
 * commander program tree so we never miss a new verb.
 *
 * Install:
 *   bash:  source <(borjie completion bash)
 *   zsh:   borjie completion zsh > "${fpath[1]}/_borjie"
 *   fish:  borjie completion fish > ~/.config/fish/completions/borjie.fish
 *
 * Dynamic completion (e.g. `borjie drafts show <TAB>` → recent ids)
 * is provided via the hidden `__complete` subcommand which any of
 * the shell scripts can call. We deliberately keep the resolver
 * lightweight and read-only so a stale token never blocks the shell.
 */

import type { Command } from 'commander';
import type { BorjieLogger } from '../logger.js';
import { loadProfile } from '../profiles.js';
import { activeProfileName } from './_session.js';
import { createHttpClient } from '../http.js';
import { listSessions } from '../sessions.js';
import { listProfiles } from '../profiles.js';

export type CompletionShell = 'bash' | 'zsh' | 'fish';

export function generateCompletion(shell: CompletionShell, program: Command): string {
  const commands = collectCommands(program);
  switch (shell) {
    case 'bash':
      return bashScript(commands);
    case 'zsh':
      return zshScript(commands);
    case 'fish':
      return fishScript(commands);
  }
}

interface CommandShape {
  readonly path: readonly string[];
  readonly options: readonly string[];
}

function collectCommands(program: Command): readonly CommandShape[] {
  const out: CommandShape[] = [];
  const walk = (cmd: Command, prefix: readonly string[]): void => {
    const path = [...prefix, cmd.name()];
    const options = cmd.options.flatMap((o) =>
      [o.short, o.long].filter((s): s is string => typeof s === 'string'),
    );
    out.push({ path, options });
    for (const c of cmd.commands ?? []) walk(c, path);
  };
  for (const c of program.commands ?? []) walk(c, []);
  return out;
}

function topLevelNames(commands: readonly CommandShape[]): readonly string[] {
  const names = new Set<string>();
  for (const c of commands) {
    const first = c.path[0];
    if (first) names.add(first);
  }
  return [...names].sort();
}

function bashScript(commands: readonly CommandShape[]): string {
  const top = topLevelNames(commands).join(' ');
  return `# borjie bash completion
_borjie_completion() {
  local cur prev words cword
  _init_completion || return
  local commands="${top}"
  if [ "$cword" -eq 1 ]; then
    COMPREPLY=( $(compgen -W "$commands" -- "$cur") )
    return
  fi
  # Delegate to borjie for dynamic completion (entity ids, etc).
  local hints
  hints=$(borjie __complete "$cword" "$\{words[@]\}" 2>/dev/null)
  if [ -n "$hints" ]; then
    COMPREPLY=( $(compgen -W "$hints" -- "$cur") )
    return
  fi
  COMPREPLY=( $(compgen -W "$commands" -- "$cur") )
}
complete -F _borjie_completion borjie
`;
}

function zshScript(commands: readonly CommandShape[]): string {
  const top = topLevelNames(commands).join(' ');
  return `#compdef borjie
# borjie zsh completion
_borjie() {
  local -a verbs hints
  verbs=(${top})
  if (( CURRENT == 2 )); then
    _describe 'command' verbs
    return
  fi
  hints=( \${(f)"$(borjie __complete $CURRENT $words 2>/dev/null)"} )
  if (( $#hints )); then
    _describe 'completion' hints
    return
  fi
  _describe 'command' verbs
}
_borjie "$@"
`;
}

function fishScript(commands: readonly CommandShape[]): string {
  const top = topLevelNames(commands);
  const verbCompletes = top
    .map((v) => `complete -c borjie -n '__fish_use_subcommand' -a '${v}'`)
    .join('\n');
  return `# borjie fish completion
function __borjie_complete
  set -l cmdline (commandline -opc)
  set -l cursor (count $cmdline)
  borjie __complete $cursor $cmdline 2>/dev/null
end

${verbCompletes}
complete -c borjie -n 'not __fish_use_subcommand' -a '(__borjie_complete)'
`;
}

export async function completionCommand(opts: {
  readonly logger: BorjieLogger;
  readonly program: Command;
  readonly shell: string;
}): Promise<void> {
  const shell = opts.shell.toLowerCase();
  if (shell !== 'bash' && shell !== 'zsh' && shell !== 'fish') {
    opts.logger.error(`Unsupported shell: ${opts.shell}. Use bash, zsh, or fish.`);
    process.exitCode = 1;
    return;
  }
  const script = generateCompletion(shell, opts.program);
  process.stdout.write(script);
}

/**
 * Hidden `__complete` subcommand the shell scripts call for dynamic
 * suggestions. Receives `cursor argv...` and returns newline-separated
 * candidates on stdout. Never throws.
 */
export async function completeDynamic(args: readonly string[]): Promise<void> {
  try {
    const cursor = Number.parseInt(args[0] ?? '0', 10);
    const argv = args.slice(1);
    const candidates = await suggest(argv, cursor);
    if (candidates.length > 0) {
      process.stdout.write(candidates.join('\n') + '\n');
    }
  } catch {
    /* never block the shell */
  }
}

async function suggest(argv: readonly string[], _cursor: number): Promise<readonly string[]> {
  // argv[0] is 'borjie'
  const verb = argv[1];
  const sub = argv[2];
  if (verb === 'drafts' && (sub === 'show' || sub === 'lock')) {
    return await fetchDraftIds();
  }
  if (verb === 'decisions' && sub === 'show') {
    return await fetchDecisionIds();
  }
  if (verb === 'sessions' && (sub === 'show' || sub === 'resume' || sub === 'archive')) {
    return listSessions({ includeArchived: true }).map((s) => s.id);
  }
  if (verb === 'use' || verb === 'profiles') {
    return listProfiles().map((p) => p.name);
  }
  return [];
}

async function fetchDraftIds(): Promise<readonly string[]> {
  const name = activeProfileName();
  const profile = loadProfile(name);
  if (!profile) return [];
  try {
    const http = createHttpClient({
      apiBaseUrl: profile.apiUrl,
      accessToken: profile.accessToken,
    });
    const res = (await http.request<{ data?: ReadonlyArray<{ id?: string }> }>(
      '/api/v1/owner/drafts',
    )) as { data?: ReadonlyArray<{ id?: string }> } | undefined;
    return (res?.data ?? [])
      .map((r) => r.id)
      .filter((id): id is string => typeof id === 'string');
  } catch {
    return [];
  }
}

async function fetchDecisionIds(): Promise<readonly string[]> {
  const name = activeProfileName();
  const profile = loadProfile(name);
  if (!profile) return [];
  try {
    const http = createHttpClient({
      apiBaseUrl: profile.apiUrl,
      accessToken: profile.accessToken,
    });
    const res = (await http.request<{ data?: ReadonlyArray<{ id?: string }> }>(
      '/api/v1/decisions',
    )) as { data?: ReadonlyArray<{ id?: string }> } | undefined;
    return (res?.data ?? [])
      .map((r) => r.id)
      .filter((id): id is string => typeof id === 'string');
  } catch {
    return [];
  }
}
