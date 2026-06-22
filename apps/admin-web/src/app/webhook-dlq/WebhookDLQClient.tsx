'use client';

/**
 * Outbound webhook DLQ — migrated from
 * apps/admin-portal/src/pages/WebhookDLQ.tsx.
 *
 *   GET  /api/v1/webhooks/dead-letters
 *   GET  /api/v1/webhooks/dead-letters/:id
 *   POST /api/v1/webhooks/dead-letters/:id/replay
 *
 * Rendered on design-system primitives + semantic tokens. SINGLE LANGUAGE
 * PER LOCALE (canon): every user-facing string resolves to the active
 * locale via `pickByLocale`. Purely client surface — the hook falls back to
 * the project default and the post-mount effect corrects it.
 */

import { useCallback, useEffect, useState } from 'react';
import { Inbox, Repeat } from 'lucide-react';
import {
  Button,
  Card,
  Skeleton,
  Alert,
  Empty,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@borjie/design-system';
import { api } from '@/lib/api';
import { useLocale, pickByLocale } from '@/lib/locale';

interface DlqEntry {
  readonly id: string;
  readonly webhookUrl: string;
  readonly eventType: string;
  readonly lastError: string;
  readonly attempts: number;
  readonly createdAt: string;
  readonly replayedAt?: string | null;
  readonly replayedBy?: string | null;
  readonly payloadPreview?: string;
}

const S = {
  intro: {
    en: 'Dead-letter queue for outbound webhooks. Inspect payloads, replay failed deliveries.',
    sw: 'Foleni ya barua-mfu kwa webhooks zinazotoka. Kagua mizigo, rudia uwasilishaji ulioshindwa.',
  },
  loadFailed: {
    en: 'Failed to load dead-letter queue',
    sw: 'Imeshindwa kupakia foleni ya barua-mfu',
  },
  replayFailed: { en: 'Replay failed', sw: 'Kurudia kumeshindwa' },
  detailFailed: {
    en: 'Failed to load delivery detail',
    sw: 'Imeshindwa kupakia maelezo ya uwasilishaji',
  },
  emptyTitle: { en: 'Dead-letter queue is empty', sw: 'Foleni ya barua-mfu ni tupu' },
  emptyBody: {
    en: 'Failed webhook deliveries will appear here for inspection and replay.',
    sw: 'Uwasilishaji wa webhook ulioshindwa utaonekana hapa kwa ukaguzi na kurudia.',
  },
  colEvent: { en: 'Event', sw: 'Tukio' },
  colUrl: { en: 'URL', sw: 'URL' },
  colAttempts: { en: 'Attempts', sw: 'Majaribio' },
  colLastError: { en: 'Last error', sw: 'Hitilafu ya mwisho' },
  colCreated: { en: 'Created', sw: 'Imeundwa' },
  inspect: { en: 'Inspect', sw: 'Kagua' },
  replay: { en: 'Replay', sw: 'Rudia' },
  delivery: { en: 'Delivery', sw: 'Uwasilishaji' },
  close: { en: 'Close', sw: 'Funga' },
  noPreview: {
    en: 'Payload preview unavailable.',
    sw: 'Onyesho la mzigo halipatikani.',
  },
} as const;

export function WebhookDLQClient() {
  const locale = useLocale();
  const [entries, setEntries] = useState<readonly DlqEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<DlqEntry | null>(null);
  const [replaying, setReplaying] = useState<string | null>(null);
  const [inspectingId, setInspectingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await api.get<readonly DlqEntry[]>(
      '/webhooks/dead-letters?limit=100',
    );
    if (res.success && res.data) setEntries(res.data);
    else setError(res.error ?? pickByLocale(locale, S.loadFailed));
    setLoading(false);
  }, [locale]);

  useEffect(() => {
    void load();
  }, [load]);

  async function replay(entry: DlqEntry): Promise<void> {
    setReplaying(entry.id);
    setError(null);
    const res = await api.post(
      `/webhooks/dead-letters/${encodeURIComponent(entry.id)}/replay`,
      {},
    );
    setReplaying(null);
    if (res.success) void load();
    else setError(res.error ?? pickByLocale(locale, S.replayFailed));
  }

  async function inspect(entry: DlqEntry): Promise<void> {
    setInspectingId(entry.id);
    setError(null);
    const res = await api.get<DlqEntry>(
      `/webhooks/dead-letters/${encodeURIComponent(entry.id)}`,
    );
    setInspectingId(null);
    if (res.success && res.data) setSelected(res.data);
    else setError(res.error ?? pickByLocale(locale, S.detailFailed));
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <Inbox className="h-6 w-6 text-danger" />
        <p className="text-sm text-muted-foreground">
          {pickByLocale(locale, S.intro)}
        </p>
      </header>

      {error && <Alert variant="error">{error}</Alert>}

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full rounded-md" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <Empty
          title={pickByLocale(locale, S.emptyTitle)}
          description={pickByLocale(locale, S.emptyBody)}
        />
      ) : (
        <Card variant="outline" padding="none" className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{pickByLocale(locale, S.colEvent)}</TableHead>
                <TableHead>{pickByLocale(locale, S.colUrl)}</TableHead>
                <TableHead>{pickByLocale(locale, S.colAttempts)}</TableHead>
                <TableHead>{pickByLocale(locale, S.colLastError)}</TableHead>
                <TableHead>{pickByLocale(locale, S.colCreated)}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="font-medium text-foreground">
                    {e.eventType}
                  </TableCell>
                  <TableCell className="max-w-truncate-sm truncate font-mono text-xs text-muted-foreground">
                    {e.webhookUrl}
                  </TableCell>
                  <TableCell>{e.attempts}</TableCell>
                  <TableCell className="max-w-truncate-md truncate text-xs text-danger">
                    {e.lastError}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(e.createdAt).toLocaleString()}
                  </TableCell>
                  <TableCell className="space-x-2 text-right">
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      onClick={() => void inspect(e)}
                      disabled={inspectingId === e.id}
                      loading={inspectingId === e.id}
                      className="h-auto gap-1 p-0 text-xs"
                    >
                      {pickByLocale(locale, S.inspect)}
                    </Button>
                    {!e.replayedAt && (
                      <Button
                        type="button"
                        variant="link"
                        size="sm"
                        onClick={() => void replay(e)}
                        disabled={replaying === e.id}
                        loading={replaying === e.id}
                        className="h-auto gap-1 p-0 text-xs"
                        leftIcon={<Repeat className="h-3 w-3" />}
                      >
                        {pickByLocale(locale, S.replay)}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {selected && (
        <Card className="rounded-2xl p-6 text-sm transition-colors hover:border-border-strong">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-foreground">
              {pickByLocale(locale, S.delivery)} {selected.id}
            </h3>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setSelected(null)}
              className="h-auto p-0 text-xs"
            >
              {pickByLocale(locale, S.close)}
            </Button>
          </div>
          <pre className="mt-3 overflow-x-auto rounded border border-border bg-surface-sunken p-3 text-xs text-muted-foreground">
            {selected.payloadPreview ?? pickByLocale(locale, S.noPreview)}
          </pre>
        </Card>
      )}
    </div>
  );
}
