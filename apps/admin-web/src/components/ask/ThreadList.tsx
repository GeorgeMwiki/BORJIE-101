import Link from 'next/link';
import { cookies } from 'next/headers';
import { MessageSquare, AlertTriangle } from 'lucide-react';

import { PLATFORM_SESSION_COOKIE } from '@/lib/session';
import { PrefetchNavLink } from '@/components/PrefetchNavLink';

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

async function fetchThreads(cookieHeader: string): Promise<ListResult> {
  try {
    const base =
      process.env.NEXT_PUBLIC_PLATFORM_PORTAL_BASE_URL ?? 'http://localhost:3020';
    const res = await fetch(`${base}/api/platform/intelligence/threads`, {
      headers: { cookie: cookieHeader },
      cache: 'no-store',
    });
    if (res.status === 503) {
      return {
        status: 'offline',
        reason: 'Intelligence service offline (503).',
      };
    }
    if (!res.ok) {
      return {
        status: 'offline',
        reason: `Upstream returned ${res.status}. Conversation index unavailable.`,
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
      reason: 'Intelligence service unreachable.',
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
  const sessionPresent = Boolean(cookieStore.get(PLATFORM_SESSION_COOKIE)?.value);
  const result = sessionPresent
    ? await fetchThreads(cookieHeader)
    : ({ status: 'offline', reason: 'No staff session present.' } as const);

  return (
    <aside className="w-72 shrink-0 border-r border-border bg-surface-sunken flex flex-col">
      <div className="p-5 border-b border-border">
        <div className="text-xs uppercase tracking-wider text-neutral-500 mb-1">
          Industry conversations
        </div>
        <p className="text-xs text-neutral-500 leading-relaxed">
          Platform-scope threads. Observer voice only.
        </p>
      </div>

      <Link
        href="/ask"
        className="mx-4 mt-4 inline-flex items-center justify-center gap-2 rounded-md border border-signal-500/40 bg-signal-500/10 px-3 py-2 text-xs text-signal-500 hover:bg-signal-500/20"
      >
        <MessageSquare className="h-3.5 w-3.5" />
        New conversation
      </Link>

      <div className="flex-1 overflow-y-auto px-2 py-4">
        {result.status === 'offline' ? (
          <div className="mx-2 rounded-md border border-warning/40 bg-warning-subtle/10 p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <AlertTriangle className="h-3 w-3 text-warning" />
              <span className="text-xs font-medium text-warning">
                Conversation index offline
              </span>
            </div>
            <p className="text-xs text-neutral-500 leading-relaxed">
              {result.reason} No mock threads are shown.
            </p>
          </div>
        ) : result.threads.length === 0 ? (
          <div className="mx-2 text-xs text-neutral-500 leading-relaxed">
            No prior industry conversations in this window.
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
