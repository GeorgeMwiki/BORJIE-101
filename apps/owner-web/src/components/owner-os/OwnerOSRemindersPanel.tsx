'use client';

/**
 * OwnerOSRemindersPanel — list + create reminders.
 *
 * Wave OWNER-OS. Wraps `/api/v1/owner/reminders`. Defaults to email
 * channel; the operator can flip to SMS / Slack per-reminder. Sets the
 * trigger 1 hour from now by default so the owner can spot-check the
 * dispatcher.
 */

import { useEffect, useState, type ReactElement, type FormEvent } from 'react';
import { Bell, Mail, MessageCircle, Trash2 } from 'lucide-react';
import { apiRequest } from '@/lib/api-client';

interface Reminder {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly triggerAt: string;
  readonly channel: 'email' | 'sms' | 'slack';
  readonly status: 'scheduled' | 'sent' | 'failed' | 'cancelled';
  readonly dispatchedAt: string | null;
  readonly dispatchError: string | null;
}

export interface OwnerOSRemindersPanelProps {
  readonly languagePreference: 'sw' | 'en';
}

function inOneHour(): string {
  const d = new Date();
  d.setHours(d.getHours() + 1);
  return d.toISOString().slice(0, 16);
}

export function OwnerOSRemindersPanel({
  languagePreference,
}: OwnerOSRemindersPanelProps): ReactElement {
  const [items, setItems] = useState<ReadonlyArray<Reminder> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [triggerAt, setTriggerAt] = useState(inOneHour());
  const [channel, setChannel] = useState<'email' | 'sms' | 'slack'>('email');
  const [creating, setCreating] = useState(false);

  async function reload(): Promise<void> {
    try {
      const res = await apiRequest<{ reminders: ReadonlyArray<Reminder> }>(
        `/api/v1/owner/reminders`,
      );
      setItems(res.reminders ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed');
      setItems([]);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  async function onCreate(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!title.trim() || !body.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const dt = new Date(triggerAt);
      await apiRequest(`/api/v1/owner/reminders`, {
        method: 'POST',
        body: {
          title: title.trim(),
          body: body.trim(),
          triggerAt: dt.toISOString(),
          channel,
        },
      });
      setTitle('');
      setBody('');
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Create failed');
    } finally {
      setCreating(false);
    }
  }

  async function cancel(id: string): Promise<void> {
    try {
      await apiRequest(`/api/v1/owner/reminders/${id}`, {
        method: 'PATCH',
        body: { status: 'cancelled' },
      });
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Cancel failed');
    }
  }

  return (
    <div className="flex flex-col gap-4" data-testid="owner-os-reminders-panel">
      <header className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-warning">
          {languagePreference === 'sw' ? 'Vikumbusho' : 'Reminders'}
        </h2>
        <span className="inline-flex items-center gap-1 text-tiny text-neutral-500">
          <Bell aria-hidden="true" className="h-3 w-3" />
          {languagePreference === 'sw'
            ? 'Email default · SMS / Slack zinapatikana'
            : 'Email default · SMS / Slack available'}
        </span>
      </header>

      <form
        onSubmit={(e) => void onCreate(e)}
        className="grid grid-cols-1 gap-2 rounded border border-border bg-surface/30 p-3 md:grid-cols-2"
      >
        <label className="flex flex-col gap-1 text-xs md:col-span-2">
          {languagePreference === 'sw' ? 'Kichwa' : 'Title'}
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            maxLength={280}
            className="rounded border border-border bg-background px-2 py-1 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs md:col-span-2">
          {languagePreference === 'sw' ? 'Ujumbe' : 'Body'}
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            required
            rows={2}
            className="rounded border border-border bg-background px-2 py-1 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          {languagePreference === 'sw' ? 'Tarehe' : 'Trigger at'}
          <input
            type="datetime-local"
            value={triggerAt}
            onChange={(e) => setTriggerAt(e.target.value)}
            required
            className="rounded border border-border bg-background px-2 py-1 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          {languagePreference === 'sw' ? 'Njia' : 'Channel'}
          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value as 'email' | 'sms' | 'slack')}
            className="rounded border border-border bg-background px-2 py-1 text-sm"
          >
            <option value="email">Email</option>
            <option value="sms">SMS</option>
            <option value="slack">Slack</option>
          </select>
        </label>
        <div className="md:col-span-2">
          <button
            type="submit"
            disabled={creating}
            className="rounded border border-warning bg-warning/10 px-3 py-1.5 text-xs font-medium text-warning hover:bg-warning/20 disabled:opacity-50"
          >
            {creating
              ? languagePreference === 'sw'
                ? 'Inahifadhi…'
                : 'Saving…'
              : languagePreference === 'sw'
                ? 'Hifadhi kikumbusho'
                : 'Schedule reminder'}
          </button>
        </div>
      </form>

      {error ? (
        <p role="alert" className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-tiny text-destructive">
          {error}
        </p>
      ) : null}

      {items === null ? (
        <p className="text-tiny text-neutral-500">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-tiny text-neutral-500">
          {languagePreference === 'sw' ? 'Hakuna vikumbusho.' : 'No reminders yet.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((r) => (
            <li
              key={r.id}
              data-testid={`owner-os-reminder-${r.id}`}
              className="flex items-center justify-between gap-3 rounded border border-border bg-surface/40 px-3 py-2 text-xs"
            >
              <div className="flex min-w-0 flex-1 items-center gap-2">
                {r.channel === 'email' ? (
                  <Mail aria-hidden="true" className="h-4 w-4 text-warning" />
                ) : (
                  <MessageCircle aria-hidden="true" className="h-4 w-4 text-warning" />
                )}
                <div className="min-w-0">
                  <p className="truncate font-medium">{r.title}</p>
                  <p className="truncate text-tiny text-neutral-500">
                    {new Date(r.triggerAt).toLocaleString()} · {r.channel} · {r.status}
                    {r.dispatchError ? ` · ${r.dispatchError.slice(0, 60)}` : ''}
                  </p>
                </div>
              </div>
              {r.status === 'scheduled' ? (
                <button
                  type="button"
                  onClick={() => void cancel(r.id)}
                  className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-tiny hover:border-destructive hover:text-destructive"
                >
                  <Trash2 aria-hidden="true" className="h-3 w-3" />
                  {languagePreference === 'sw' ? 'Futa' : 'Cancel'}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
