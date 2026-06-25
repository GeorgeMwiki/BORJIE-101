import Link from 'next/link';
import { cookies } from 'next/headers';
import { MessageSquare, AlertTriangle } from 'lucide-react';

import { PLATFORM_SESSION_COOKIE } from '@/lib/session';
import { PrefetchNavLink } from '@/components/PrefetchNavLink';
import { requirePublicBaseUrl } from '@/lib/env-guard';
import { readLocaleFromServerCookies } from '@/lib/locale.server';
import { pickByLocale, type Locale } from '@/lib/locale-shared';

/**
 * ThreadList — left column of the /ask surface.
 *
 * Lists prior platform-scope conversations. The panel header is
 * intentionally "Industry conversations" (not "Your conversations"):
 * the observer voice is plural/institutional, and these threads
 * belong to the HQ operator's team, not a single staff member.
 *
 * Never renders mock threads. 503 from the intelligence service →
 * degraded state, no placeholders.
 */

interface ThreadSummary {
  readonly id: string;
  readonly title: string;
  readonly updatedAt: string;
}

type ListResult =
  | { readonly status: 'ok'; readonly threads: ReadonlyArray<ThreadSummary> }
  | { readonly status: 'offline'; readonly reason: string };

async function fetchThreads(
  cookieHeader: string,
  locale: Locale,
): Promise<ListResult> {
  try {
    const base = requirePublicBaseUrl(
      'NEXT_PUBLIC_PLATFORM_PORTAL_BASE_URL',
      'http://localhost:3020',
    );
    const res = await fetch(`${base}/api/platform/intelligence/threads`, {
      headers: { cookie: cookieHeader },
      cache: 'no-store',
    });
    if (res.status === 503) {
      return {
        status: 'offline',
        reason: pickByLocale(locale, {
          en: 'Intelligence service offline (503).',
          sw: 'Huduma ya akili haiko mtandaoni (503).',
        }),
      };
    }
    if (!res.ok) {
      return {
        status: 'offline',
        reason: pickByLocale(locale, {
          en: `Upstream returned ${res.status}. Conversation index unavailable.`,
          sw: `Chanzo kilirudisha ${res.status}. Faharasa ya mazungumzo haipatikani.`,
        }),
      };
    }
    const data = (await res.json()) as {
      readonly threads?: ReadonlyArray<ThreadSummary>;
    };
    return { status: 'ok', threads: data.threads ?? [] };
  } catch (error) {
    console.error('ThreadList fetch failed:', error);
    return {
      status: 'offline',
      reason: pickByLocale(locale, {
        en: 'Intelligence service unreachable.',
        sw: 'Huduma ya akili haifikiki.',
      }),
    };
  }
}

export async function ThreadList({
  activeThreadId,
}: {
  readonly activeThreadId?: string;
}) {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
  const locale = await readLocaleFromServerCookies();
  const sessionPresent = Boolean(cookieStore.get(PLATFORM_SESSION_COOKIE)?.value);
  const result = sessionPresent
    ? await fetchThreads(cookieHeader, locale)
    : ({
        status: 'offline',
        reason: pickByLocale(locale, {
          en: 'No staff session present.',
          sw: 'Hakuna kipindi cha wafanyakazi kilichopo.',
        }),
      } as const);

  return (
    <aside className="w-72 shrink-0 border-r border-border bg-surface-sunken flex flex-col">
      <div className="p-5 border-b border-border">
        <div className="text-xs uppercase tracking-wider text-neutral-500 mb-1">
          {pickByLocale(locale, {
            en: 'Industry conversations',
            sw: 'Mazungumzo ya sekta',
          })}
        </div>
        <p className="text-xs text-neutral-500 leading-relaxed">
          {pickByLocale(locale, {
            en: 'Platform-scope threads. Observer voice only.',
            sw: 'Mazungumzo ya upeo wa jukwaa. Sauti ya mtazamaji pekee.',
          })}
        </p>
      </div>

      <Link
        href="/ask"
        className="mx-4 mt-4 inline-flex items-center justify-center gap-2 rounded-md border border-signal-500/40 bg-signal-500/10 px-3 py-2 text-xs text-signal-500 hover:bg-signal-500/20"
      >
        <MessageSquare className="h-3.5 w-3.5" />
        {pickByLocale(locale, {
          en: 'New conversation',
          sw: 'Mazungumzo mapya',
        })}
      </Link>

      <div className="flex-1 overflow-y-auto px-2 py-4">
        {result.status === 'offline' ? (
          <div className="mx-2 rounded-md border border-warning/40 bg-warning-subtle/10 p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <AlertTriangle className="h-3 w-3 text-warning" />
              <span className="text-xs font-medium text-warning">
                {pickByLocale(locale, {
                  en: 'Conversation index offline',
                  sw: 'Faharasa ya mazungumzo haiko mtandaoni',
                })}
              </span>
            </div>
            <p className="text-xs text-neutral-500 leading-relaxed">
              {result.reason}{' '}
              {pickByLocale(locale, {
                en: 'No mock threads are shown.',
                sw: 'Hakuna mazungumzo bandia yanayoonyeshwa.',
              })}
            </p>
          </div>
        ) : result.threads.length === 0 ? (
          <div className="mx-2 text-xs text-neutral-500 leading-relaxed">
            {pickByLocale(locale, {
              en: 'No prior industry conversations in this window.',
              sw: 'Hakuna mazungumzo ya awali ya sekta katika kipindi hiki.',
            })}
          </div>
        ) : (
          <ul className="space-y-1">
            {result.threads.map((t) => {
              const active = t.id === activeThreadId;
              return (
                <li key={t.id}>
                  <PrefetchNavLink
                    href={`/ask/${t.id}`}
                    className={
                      active
                        ? 'block rounded-md border border-signal-500/30 bg-signal-500/10 px-3 py-2 text-xs text-foreground'
                        : 'block rounded-md border border-transparent px-3 py-2 text-xs text-neutral-400 hover:bg-surface hover:text-foreground'
                    }
                  >
                    <div className="truncate">{t.title}</div>
                    <div className="text-neutral-500 mt-0.5">{t.updatedAt}</div>
                  </PrefetchNavLink>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
