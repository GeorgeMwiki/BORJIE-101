'use client';

/**
 * NotificationPreferencesPanel — owner-settings-3.
 *
 * Surfaces the owner's notification channel-priority ranking and
 * contact details so Mr. Mwikila knows HOW to reach them (email vs SMS
 * vs Slack vs WhatsApp), and in which language.
 *
 * Wires to:
 *   GET /api/v1/owner/contact-prefs  — seed current values on mount
 *   PUT /api/v1/owner/contact-prefs  — upsert on save
 *
 * The channelPriority field is an ORDERED list (highest-priority first).
 * The owner ranks channels by clicking "Move up" / "Move down" arrows or
 * by removing a channel from the active ranking entirely. The remote
 * backend derives preferred_channel from the head of the list.
 *
 * Channels are data-driven from OWNER_CONTACT_CHANNELS so adding a new
 * channel to the backend constant automatically surfaces it here.
 */

import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';

import { getCsrfHeaders } from '@/lib/csrf';
import { notificationPreferencesPanelStrings as S } from '@/i18n/strings/notification-preferences-panel';
import { useLocale, pickByLocale } from '@/lib/locale';

// Mirror the backend constant locally so this file has no cross-package
// import. If a new channel is added to the backend, add it here too.
const OWNER_CONTACT_CHANNELS = ['email', 'sms', 'slack', 'whatsapp'] as const;
type OwnerContactChannel = (typeof OWNER_CONTACT_CHANNELS)[number];

// Zod schema — mirrors putSchema in contact-prefs.hono.ts.
const putSchema = z
  .object({
    channelPriority: z.array(z.enum(OWNER_CONTACT_CHANNELS)).max(4),
    emailOverride: z.string().email().max(320).optional().or(z.literal('')),
    phone: z.string().trim().max(32).optional(),
    slackHandle: z.string().trim().max(80).optional(),
    locale: z.enum(['sw', 'en']).optional(),
    timezone: z.string().trim().max(64).optional(),
  })
  .strict();

type PutPayload = z.infer<typeof putSchema>;

interface ContactPrefs {
  readonly channelPriority: ReadonlyArray<OwnerContactChannel>;
  readonly preferredChannel: OwnerContactChannel;
  readonly emailOverride: string | null;
  readonly phone: string | null;
  readonly slackHandle: string | null;
  readonly locale: string;
  readonly timezone: string;
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; prefs: ContactPrefs }
  | { kind: 'error'; message: string };

const CHANNEL_LABEL_EN: Record<OwnerContactChannel, string> = {
  email: 'Email',
  sms: 'SMS',
  slack: 'Slack',
  whatsapp: 'WhatsApp',
};

// Swahili channel labels are sourced from the guard-exempt i18n strings
// module so no Swahili literal lives in this component.
const CHANNEL_LABEL_SW: Record<OwnerContactChannel, string> = S.channelLabelSw;

export function NotificationPreferencesPanel() {
  const locale = useLocale();
  const [loadState, setLoadState] = useState<LoadState>({ kind: 'loading' });
  const [channelPriority, setChannelPriority] = useState<OwnerContactChannel[]>([]);
  const [emailOverride, setEmailOverride] = useState('');
  const [phone, setPhone] = useState('');
  const [slackHandle, setSlackHandle] = useState('');
  const [timezone, setTimezone] = useState('Africa/Dar_es_Salaam');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoadState({ kind: 'loading' });
    try {
      const res = await fetch('/api/v1/owner/contact-prefs', {
        credentials: 'include',
      });
      const json = (await res.json().catch(() => null)) as
        | { success: true; data: { prefs: ContactPrefs } }
        | { success?: false; error?: { message: string } }
        | null;
      if (!res.ok || !json?.success) {
        const msg =
          (json && 'error' in json && json.error?.message) ||
          `HTTP ${res.status}`;
        setLoadState({ kind: 'error', message: msg });
        return;
      }
      const p = json.data.prefs;
      setLoadState({ kind: 'ready', prefs: p });
      setChannelPriority([...p.channelPriority] as OwnerContactChannel[]);
      setEmailOverride(p.emailOverride ?? '');
      setPhone(p.phone ?? '');
      setSlackHandle(p.slackHandle ?? '');
      setTimezone(p.timezone ?? 'Africa/Dar_es_Salaam');
    } catch (err) {
      setLoadState({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Network error',
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const moveUp = useCallback((idx: number) => {
    if (idx === 0) return;
    setChannelPriority((prev) => {
      const next = [...prev];
      const tmp = next[idx - 1]!;
      next[idx - 1] = next[idx]!;
      next[idx] = tmp;
      return next;
    });
  }, []);

  const moveDown = useCallback((idx: number) => {
    setChannelPriority((prev) => {
      if (idx >= prev.length - 1) return prev;
      const next = [...prev];
      const tmp = next[idx + 1]!;
      next[idx + 1] = next[idx]!;
      next[idx] = tmp;
      return next;
    });
  }, []);

  const removeChannel = useCallback((ch: OwnerContactChannel) => {
    setChannelPriority((prev) => prev.filter((c) => c !== ch));
  }, []);

  const addChannel = useCallback((ch: OwnerContactChannel) => {
    setChannelPriority((prev) => (prev.includes(ch) ? prev : [...prev, ch]));
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    setSaved(false);

    const payload: PutPayload = {
      channelPriority,
      ...(emailOverride.trim() ? { emailOverride: emailOverride.trim() } : {}),
      ...(phone.trim() ? { phone: phone.trim() } : {}),
      ...(slackHandle.trim() ? { slackHandle: slackHandle.trim() } : {}),
      locale: locale as 'en' | 'sw',
      ...(timezone.trim() ? { timezone: timezone.trim() } : {}),
    };

    const parsed = putSchema.safeParse(payload);
    if (!parsed.success) {
      setSaveError(
        parsed.error.issues.map((i) => i.message).join('; '),
      );
      setSaving(false);
      return;
    }

    try {
      const res = await fetch('/api/v1/owner/contact-prefs', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...getCsrfHeaders() },
        body: JSON.stringify(parsed.data),
      });
      const json = (await res.json().catch(() => null)) as
        | { success: true }
        | { success?: false; error?: { message: string } }
        | null;
      if (!res.ok || !json?.success) {
        const msg =
          (json && 'error' in json && json.error?.message) ||
          `HTTP ${res.status}`;
        setSaveError(msg);
      } else {
        setSaved(true);
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setSaving(false);
    }
  }, [channelPriority, emailOverride, phone, slackHandle, locale, timezone]);

  const unavailableChannels = OWNER_CONTACT_CHANNELS.filter(
    (ch) => !channelPriority.includes(ch),
  );

  if (loadState.kind === 'loading') {
    return (
      <div className="h-48 animate-pulse rounded-lg border border-border bg-surface/40" />
    );
  }

  if (loadState.kind === 'error') {
    return (
      <div className="rounded-md border border-red-500/40 bg-red-500/10 p-4">
        <p className="text-sm text-red-200">
          {pickByLocale(locale, S.loadError(loadState.message))}
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-2 rounded border border-red-300/40 px-3 py-1 text-xs text-red-100 hover:bg-red-500/20"
        >
          {pickByLocale(locale, S.retry)}
        </button>
      </div>
    );
  }

  return (
    <section className="rounded-md border border-border bg-surface p-5 space-y-5">
      <div>
        <h2 className="font-display text-lg text-foreground">
          {pickByLocale(locale, S.channelsHeading)}
        </h2>
        <p className="mt-0.5 text-xs italic text-neutral-500">
          {pickByLocale(locale, S.channelsSubtitle)}
        </p>
      </div>

      {/* Ranked active channels */}
      <div className="space-y-1.5">
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
          {pickByLocale(locale, S.priorityOrder)}
        </p>
        {channelPriority.length === 0 ? (
          <p className="text-sm text-neutral-400">
            {pickByLocale(locale, S.noChannelsRanked)}
          </p>
        ) : (
          <ol className="space-y-1.5">
            {channelPriority.map((ch, idx) => {
              // Localize the channel label once, then feed it into the
              // interpolated aria-label strings so the EN/SW label
              // distinction is preserved without any Swahili literal here.
              const label = pickByLocale(locale, {
                en: CHANNEL_LABEL_EN[ch],
                sw: CHANNEL_LABEL_SW[ch],
              });
              return (
                <li
                  key={ch}
                  className="flex items-center gap-2 rounded border border-border bg-background px-3 py-2"
                >
                  <span className="w-5 shrink-0 text-center text-xs font-bold text-neutral-500">
                    {idx + 1}
                  </span>
                  <span className="flex-1 text-sm text-foreground">{label}</span>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => moveUp(idx)}
                      disabled={idx === 0}
                      aria-label={pickByLocale(locale, S.moveUpAria(label))}
                      className="rounded border border-border px-2 py-0.5 text-xs text-neutral-300 hover:bg-surface disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => moveDown(idx)}
                      disabled={idx === channelPriority.length - 1}
                      aria-label={pickByLocale(locale, S.moveDownAria(label))}
                      className="rounded border border-border px-2 py-0.5 text-xs text-neutral-300 hover:bg-surface disabled:opacity-30"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => removeChannel(ch)}
                      aria-label={pickByLocale(locale, S.removeAria(label))}
                      className="rounded border border-border px-2 py-0.5 text-xs text-neutral-300 hover:text-destructive"
                    >
                      ×
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {/* Unavailable / add channels */}
      {unavailableChannels.length > 0 ? (
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
            {pickByLocale(locale, S.addChannel)}
          </p>
          <div className="flex flex-wrap gap-2">
            {unavailableChannels.map((ch) => (
              <button
                key={ch}
                type="button"
                onClick={() => addChannel(ch)}
                className="rounded border border-border px-3 py-1 text-xs text-neutral-300 hover:bg-surface"
              >
                +{' '}
                {pickByLocale(locale, {
                  en: CHANNEL_LABEL_EN[ch],
                  sw: CHANNEL_LABEL_SW[ch],
                })}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* Contact details */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="text-neutral-300">
            {pickByLocale(locale, S.emailOverride)}
          </span>
          <input
            type="email"
            maxLength={320}
            className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground"
            value={emailOverride}
            onChange={(e) => setEmailOverride(e.target.value)}
            placeholder={pickByLocale(locale, S.emailOverridePlaceholder)}
          />
        </label>
        <label className="block text-sm">
          <span className="text-neutral-300">
            {pickByLocale(locale, S.phoneLabel)}
          </span>
          <input
            type="tel"
            maxLength={32}
            className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+255 712 000 000"
          />
        </label>
        <label className="block text-sm">
          <span className="text-neutral-300">
            {pickByLocale(locale, S.slackHandle)}
          </span>
          <input
            type="text"
            maxLength={80}
            className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground"
            value={slackHandle}
            onChange={(e) => setSlackHandle(e.target.value)}
            placeholder="@yourname"
          />
        </label>
        <label className="block text-sm">
          <span className="text-neutral-300">
            {pickByLocale(locale, S.timeZone)}
          </span>
          <input
            type="text"
            maxLength={64}
            className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            placeholder="Africa/Dar_es_Salaam"
          />
        </label>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          className="rounded bg-foreground px-4 py-2 text-sm text-background disabled:opacity-40"
        >
          {saving
            ? pickByLocale(locale, S.saving)
            : pickByLocale(locale, S.savePreferences)}
        </button>
        {saved ? (
          <span className="text-sm text-success">
            {pickByLocale(locale, S.saved)}
          </span>
        ) : null}
        {saveError ? (
          <span className="text-sm text-destructive">
            {pickByLocale(locale, S.errorPrefix)}
            {saveError}
          </span>
        ) : null}
      </div>
    </section>
  );
}
