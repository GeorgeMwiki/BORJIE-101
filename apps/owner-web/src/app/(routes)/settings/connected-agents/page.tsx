import type { Metadata } from 'next';
import { ConnectedAgentsList } from './connected-agents-list';
import { readLocaleFromServerCookies } from '@/lib/locale.server';
import { pickByLocale } from '@/lib/locale-shared';
import { settingsPagesStrings as S } from '@/i18n/strings/settings-pages';

const P = S.connectedAgentsPage;

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const locale = await readLocaleFromServerCookies();
  return {
    title: pickByLocale(locale, P.metaTitle),
  };
}

/**
 * /settings/connected-agents — owner-visible roster of external agents
 * that hold an active access token for this user, with per-row revoke.
 *
 * Backed by GET /api/v1/oauth/agent-tokens (returns active tokens
 * scoped to the authenticated user) and POST /api/v1/oauth/revoke.
 */
export default async function ConnectedAgentsPage() {
  const locale = await readLocaleFromServerCookies();

  return (
    <>
      <header className="border-b border-border px-8 py-6">
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-muted-foreground">
            O-W-22.AGENTS
          </span>
          <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-badge text-muted-foreground">
            {pickByLocale(locale, P.ownerBadge)}
          </span>
        </div>
        <h1 className="mt-1 font-display text-3xl text-foreground">
          {pickByLocale(locale, P.heading)}
        </h1>
        <p className="mt-3 max-w-3xl text-sm text-muted-foreground">
          {pickByLocale(locale, P.intro)}
        </p>
      </header>
      <div className="px-8 py-6">
        <ConnectedAgentsList initialLocale={locale} />
      </div>
    </>
  );
}
