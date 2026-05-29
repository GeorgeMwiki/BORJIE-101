import { ConnectedAgentsList } from './connected-agents-list';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Wakala walioongezwa — Borjie',
};

/**
 * /settings/connected-agents — owner-visible roster of external agents
 * that hold an active access token for this user, with per-row revoke.
 *
 * Backed by GET /api/v1/oauth/agent-tokens (returns active tokens
 * scoped to the authenticated user) and POST /api/v1/oauth/revoke.
 */
export default function ConnectedAgentsPage() {
  return (
    <>
      <header className="border-b border-border px-8 py-6">
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-neutral-500">
            O-W-22.AGENTS
          </span>
          <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-badge text-neutral-400">
            Owner
          </span>
        </div>
        <h1 className="mt-1 font-display text-3xl text-foreground">
          Connected agents
        </h1>
        <p className="mt-0.5 text-xs italic text-neutral-500">
          Wakala walioongezwa
        </p>
        <p className="mt-3 max-w-3xl text-sm text-neutral-300">
          External agents (Claude Code, Cursor, Windsurf, custom MCP /
          CLI / SDK clients) that hold an active access token for your
          account. Revoke any agent at any time — revocation is
          immediate.
        </p>
        <p className="mt-1 max-w-3xl text-sm italic text-neutral-500">
          Wakala wa nje wenye ruhusa hai kwa akaunti yako. Unaweza
          kuondoa idhini wakati wowote.
        </p>
      </header>
      <div className="px-8 py-6">
        <ConnectedAgentsList />
      </div>
    </>
  );
}
