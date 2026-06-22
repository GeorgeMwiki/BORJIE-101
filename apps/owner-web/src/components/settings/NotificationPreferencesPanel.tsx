'use client';

/**
 * NotificationPreferencesPanel — owner-settings delivery preferences.
 *
 * Drives the dispatcher-consulted preference table over
 *   GET /api/v1/me/notification-preferences  — seed on mount
 *   PUT /api/v1/me/notification-preferences  — upsert on save
 * (see services/api-gateway/src/routes/notification-preferences.router.ts).
 *
 * What an owner controls here is EXACTLY what the notification dispatcher's
 * `shouldDeliver` gate honors (services/api-gateway/src/index.ts):
 *   - per-channel on/off (email / sms / push / whatsapp) — opt-OUT: a channel
 *     blocks delivery only when explicitly turned off;
 *   - per-template opt-outs keyed by `template_key`;
 *   - a quiet-hours window (HH:MM start + end, sent together).
 *
 * The save is optimistic: the on-screen toggle state updates immediately; the
 * confirmed server snapshot replaces it on success, and the prior snapshot is
 * restored on failure. All Swahili copy lives in the guard-exempt i18n strings
 * module — no Swahili literal appears in this component.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Skeleton, Alert, Input, FormField } from '@borjie/design-system';

import { notificationPreferencesPanelStrings as S } from '@/i18n/strings/notification-preferences-panel';
import { useLocale, pickByLocale } from '@/lib/locale';

import {
  NOTIFICATION_CHANNELS,
  type NotifPrefs,
  type NotificationChannel,
  type PutPreferencesBody,
  fetchNotificationPreferences,
  isEnabled,
  resolveTemplateKeys,
  saveNotificationPreferences,
} from './notification-preferences-client';

const TIME_HHMM = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

const CHANNEL_LABEL_EN: Record<NotificationChannel, string> = {
  email: 'Email',
  sms: 'SMS',
  push: S.channelPushEn,
  whatsapp: 'WhatsApp',
};

const CHANNEL_LABEL_SW: Record<NotificationChannel, string> = {
  email: S.channelLabelSw.email,
  sms: S.channelLabelSw.sms,
  push: S.channelPushSw,
  whatsapp: S.channelLabelSw.whatsapp,
};

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; prefs: NotifPrefs }
  | { kind: 'error'; message: string };

const EMPTY_MAP: Readonly<Record<string, boolean>> = {};

export function NotificationPreferencesPanel() {
  const locale = useLocale();
  const [loadState, setLoadState] = useState<LoadState>({ kind: 'loading' });

  // Working draft, seeded from the loaded snapshot and edited locally.
  const [channels, setChannels] = useState<Readonly<Record<string, boolean>>>(EMPTY_MAP);
  const [templates, setTemplates] = useState<Readonly<Record<string, boolean>>>(EMPTY_MAP);
  const [quietStart, setQuietStart] = useState('');
  const [quietEnd, setQuietEnd] = useState('');

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const seedFrom = useCallback((p: NotifPrefs) => {
    setChannels(p.channels);
    setTemplates(p.templates);
    setQuietStart(p.quietHoursStart ?? '');
    setQuietEnd(p.quietHoursEnd ?? '');
  }, []);

  const load = useCallback(async () => {
    setLoadState({ kind: 'loading' });
    try {
      const prefs = await fetchNotificationPreferences();
      setLoadState({ kind: 'ready', prefs });
      seedFrom(prefs);
    } catch (err) {
      setLoadState({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Network error',
      });
    }
  }, [seedFrom]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleChannel = useCallback((ch: NotificationChannel) => {
    setSaved(false);
    setChannels((prev) => ({ ...prev, [ch]: !isEnabled(prev, ch) }));
  }, []);

  const toggleTemplate = useCallback((key: string) => {
    setSaved(false);
    setTemplates((prev) => ({ ...prev, [key]: !isEnabled(prev, key) }));
  }, []);

  const clearQuietHours = useCallback(() => {
    setSaved(false);
    setQuietStart('');
    setQuietEnd('');
  }, []);

  const templateKeys = useMemo(
    () => resolveTemplateKeys(templates),
    [templates],
  );

  // Only the four contract channels are sent; the draft map may carry stray
  // keys from a previous server snapshot, so we project onto the known set.
  const buildBody = useCallback((): PutPreferencesBody => {
    const channelsBody: NonNullable<PutPreferencesBody['channels']> = {};
    for (const ch of NOTIFICATION_CHANNELS) {
      channelsBody[ch] = isEnabled(channels, ch);
    }
    const templatesBody: Record<string, boolean> = {};
    for (const key of templateKeys) {
      templatesBody[key] = isEnabled(templates, key);
    }
    const hasQuiet = quietStart.trim() !== '' && quietEnd.trim() !== '';
    return {
      channels: channelsBody,
      templates: templatesBody,
      ...(hasQuiet
        ? { quietHoursStart: quietStart.trim(), quietHoursEnd: quietEnd.trim() }
        : {}),
    };
  }, [channels, templates, templateKeys, quietStart, quietEnd]);

  const save = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    setSaved(false);

    // Quiet-hours must be a complete pair or fully cleared; mirror the router.
    const startSet = quietStart.trim() !== '';
    const endSet = quietEnd.trim() !== '';
    if (startSet !== endSet) {
      setSaveError(pickByLocale(locale, S.quietHoursPairError));
      setSaving(false);
      return;
    }
    if (
      (startSet && !TIME_HHMM.test(quietStart.trim())) ||
      (endSet && !TIME_HHMM.test(quietEnd.trim()))
    ) {
      setSaveError(pickByLocale(locale, S.quietHoursPairError));
      setSaving(false);
      return;
    }

    const prior =
      loadState.kind === 'ready' ? loadState.prefs : undefined;
    try {
      const confirmed = await saveNotificationPreferences(buildBody());
      setLoadState({ kind: 'ready', prefs: confirmed });
      seedFrom(confirmed);
      setSaved(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Network error');
      // Roll the optimistic draft back to the last confirmed snapshot.
      if (prior) seedFrom(prior);
    } finally {
      setSaving(false);
    }
  }, [buildBody, loadState, locale, quietStart, quietEnd, seedFrom]);

  if (loadState.kind === 'loading') {
    return <Skeleton className="h-48 rounded-lg border border-border" />;
  }

  if (loadState.kind === 'error') {
    return (
      <Alert variant="error">
        <p className="text-sm">
          {pickByLocale(locale, S.loadError(loadState.message))}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void load()}
          className="mt-2"
        >
          {pickByLocale(locale, S.retry)}
        </Button>
      </Alert>
    );
  }

  return (
    <section className="rounded-md border border-border bg-surface p-5 space-y-6">
      <div>
        <h2 className="font-display text-lg text-foreground">
          {pickByLocale(locale, S.deliveryHeading)}
        </h2>
        <p className="mt-0.5 text-xs italic text-muted-foreground">
          {pickByLocale(locale, S.deliverySubtitle)}
        </p>
      </div>

      {/* Per-channel on/off */}
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {pickByLocale(locale, S.channelOnOffSection)}
        </p>
        <ul className="space-y-1.5">
          {NOTIFICATION_CHANNELS.map((ch) => {
            const on = isEnabled(channels, ch);
            const label = pickByLocale(locale, {
              en: CHANNEL_LABEL_EN[ch],
              sw: CHANNEL_LABEL_SW[ch],
            });
            return (
              <li
                key={ch}
                className="flex items-center justify-between gap-3 rounded border border-border bg-background px-3 py-2"
              >
                <span className="text-sm text-foreground">{label}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-label={pickByLocale(locale, S.channelToggleAria(label))}
                  onClick={() => toggleChannel(ch)}
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                    on ? 'bg-success' : 'bg-muted'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-card transition-transform ${
                      on ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </li>
            );
          })}
        </ul>
        <p className="text-xs text-muted-foreground">
          {pickByLocale(locale, S.channelInAppNote)}
        </p>
      </div>

      {/* Per-template opt-outs */}
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {pickByLocale(locale, S.templatesSection)}
        </p>
        <p className="text-xs text-muted-foreground">
          {pickByLocale(locale, S.templatesSubtitle)}
        </p>
        <ul className="space-y-1.5">
          {templateKeys.map((key) => {
            const on = isEnabled(templates, key);
            const label = pickByLocale(locale, S.templateLabel(key));
            return (
              <li
                key={key}
                className="flex items-center justify-between gap-3 rounded border border-border bg-background px-3 py-2"
              >
                <span className="text-sm text-foreground">{label}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-label={pickByLocale(locale, S.templateToggleAria(label))}
                  onClick={() => toggleTemplate(key)}
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                    on ? 'bg-success' : 'bg-muted'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-card transition-transform ${
                      on ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Quiet-hours window */}
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {pickByLocale(locale, S.quietHoursSection)}
        </p>
        <p className="text-xs text-muted-foreground">
          {pickByLocale(locale, S.quietHoursSubtitle)}
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <FormField label={pickByLocale(locale, S.quietHoursStartLabel)}>
            <Input
              type="time"
              className="w-auto"
              value={quietStart}
              onChange={(e) => {
                setSaved(false);
                setQuietStart(e.target.value);
              }}
            />
          </FormField>
          <FormField label={pickByLocale(locale, S.quietHoursEndLabel)}>
            <Input
              type="time"
              className="w-auto"
              value={quietEnd}
              onChange={(e) => {
                setSaved(false);
                setQuietEnd(e.target.value);
              }}
            />
          </FormField>
          {quietStart || quietEnd ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={clearQuietHours}
            >
              {pickByLocale(locale, S.quietHoursClear)}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button
          type="button"
          loading={saving}
          onClick={() => void save()}
        >
          {saving
            ? pickByLocale(locale, S.saving)
            : pickByLocale(locale, S.savePreferences)}
        </Button>
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
