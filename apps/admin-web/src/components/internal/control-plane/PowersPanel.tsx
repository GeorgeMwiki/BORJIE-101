'use client';

import { useMemo, useState } from 'react';
import { Button, Skeleton, FormField, Input } from '@borjie/design-system';
import { StubBadge } from '../StubBadge';
import { Toast } from '../Toast';
import { ScopeSelector } from './ScopeSelector';
import {
  usePowersQuery,
  useSetPowerFlag,
} from '@/lib/internal/control-plane/queries';
import {
  KNOWN_POWER_FLAGS,
  KNOWN_FLAG_NAMES,
  type KnownFlag,
} from '@/lib/internal/control-plane/known-flags';
import type { PowerFlag, Scope } from '@/lib/internal/control-plane/api';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';

const FLAG_RE = /^[a-z][a-z0-9_]*$/;

const S = {
  platformWide: { en: 'Platform-wide default', sw: 'Chaguo-msingi la jukwaa zima' },
  tenantOverride: { en: 'Tenant override', sw: 'Ubatilishaji wa mteja' },
  reasonLabel: {
    en: 'Reason (audited, required for every write)',
    sw: 'Sababu (inakaguliwa, inahitajika kwa kila andiko)',
  },
  reasonPlaceholder: {
    en: 'Why are you changing this power?',
    sw: 'Kwa nini unabadilisha mamlaka haya?',
  },
  loading: { en: 'Loading powers…', sw: 'Inapakia mamlaka…' },
  sovereignLocked: { en: 'Sovereign · locked', sw: 'Huru · imefungwa' },
  readError: { en: 'Read error', sw: 'Hitilafu ya kusoma' },
  unset: { en: 'unset', sw: 'haijawekwa' },
  on: { en: 'On', sw: 'Imewashwa' },
  off: { en: 'Off', sw: 'Imezimwa' },
  enable: { en: 'Enable', sw: 'Wezesha' },
  disable: { en: 'Disable', sw: 'Zima' },
  addPlaceholder: { en: 'add_flag_name', sw: 'add_flag_name' },
  addFlagAria: { en: 'Add a flag to manage', sw: 'Ongeza bendera ya kusimamia' },
  addFlag: { en: 'Add flag', sw: 'Ongeza bendera' },
  flagSnakeCase: {
    en: 'Flag must be snake_case (a-z, 0-9, _).',
    sw: 'Bendera lazima iwe snake_case (a-z, 0-9, _).',
  },
  flagAlready: { en: 'Flag already in the list.', sw: 'Bendera tayari ipo kwenye orodha.' },
  reasonRequired: {
    en: 'Enter a reason (≥ 8 chars) before changing a power flag.',
    sw: 'Weka sababu (≥ herufi 8) kabla ya kubadilisha bendera ya mamlaka.',
  },
  audit: { en: 'audit', sw: 'ukaguzi' },
  failed: { en: 'Failed', sw: 'Imeshindwa' },
} as const;

function currentValue(flag: PowerFlag, scope: Scope): boolean | null {
  if (scope === 'global') return flag.globalValue;
  const override = flag.tenantOverrides.find((o) => `tenant:${o.tenantId}` === scope);
  return override?.value ?? null;
}

function labelFor(known: ReadonlyArray<KnownFlag>, flagName: string): string {
  return known.find((k) => k.flag === flagName)?.label ?? flagName;
}

function descriptionFor(
  known: ReadonlyArray<KnownFlag>,
  flagName: string,
): string | null {
  return known.find((k) => k.flag === flagName)?.description ?? null;
}

/**
 * POWERS — capability / kill-switch flag toggles, global + per-tenant scope.
 *
 * Reads GET /powers for the curated + ad-hoc flag set and writes PUT /powers.
 * Sovereign rails are rejected by the gateway (and badged read-only here). Each
 * write requires a reason (audited) and surfaces the journal id + previous value
 * so the operator sees the audit trail land.
 */
export function PowersPanel({
  initialLocale,
}: {
  readonly initialLocale?: Locale;
} = {}): JSX.Element {
  const locale = useLocale(initialLocale);
  const [scope, setScope] = useState<Scope>('global');
  const [extraFlags, setExtraFlags] = useState<ReadonlyArray<string>>([]);
  const [newFlag, setNewFlag] = useState('');
  const [reason, setReason] = useState('');
  const [toast, setToast] = useState<string | null>(null);

  const flagNames = useMemo(
    () => [...new Set([...KNOWN_FLAG_NAMES, ...extraFlags])],
    [extraFlags],
  );
  const query = usePowersQuery(flagNames);
  const mutation = useSetPowerFlag(flagNames);

  const reasonValid = reason.trim().length >= 8;

  function addFlag() {
    const candidate = newFlag.trim();
    if (!FLAG_RE.test(candidate)) {
      setToast(pickByLocale(locale, S.flagSnakeCase));
      return;
    }
    if (flagNames.includes(candidate)) {
      setToast(pickByLocale(locale, S.flagAlready));
      return;
    }
    setExtraFlags((prev) => [...prev, candidate]);
    setNewFlag('');
  }

  function toggle(flag: PowerFlag, next: boolean) {
    if (flag.sovereign) return;
    if (!reasonValid) {
      setToast(pickByLocale(locale, S.reasonRequired));
      return;
    }
    mutation.mutate(
      { flag: flag.flag, enabled: next, scope, reason: reason.trim() },
      {
        onSuccess: (res) =>
          setToast(
            `${res.flag} → ${res.enabled ? pickByLocale(locale, S.on) : pickByLocale(locale, S.off)} (${res.scope})${
              res.journalId
                ? ` · ${pickByLocale(locale, S.audit)} ${res.journalId.slice(0, 8)}…`
                : ''
            }`,
          ),
        onError: (err) => setToast(`${pickByLocale(locale, S.failed)}: ${err.message}`),
      },
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <ScopeSelector scope={scope} onChange={setScope} initialLocale={locale} />
        <StubBadge tone="info">
          {scope === 'global'
            ? pickByLocale(locale, S.platformWide)
            : pickByLocale(locale, S.tenantOverride)}
        </StubBadge>
      </div>

      <FormField label={pickByLocale(locale, S.reasonLabel)} name="reason">
        <Input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={pickByLocale(locale, S.reasonPlaceholder)}
          error={reason.length > 0 && !reasonValid}
        />
      </FormField>

      {query.isPending ? (
        <div className="space-y-2 rounded-lg border border-border bg-surface p-4">
          <Skeleton className="h-12 w-full rounded-md" />
          <Skeleton className="h-12 w-full rounded-md" />
        </div>
      ) : query.isError ? (
        <p className="text-sm text-danger">{query.error.message}</p>
      ) : (
        <div className="divide-y divide-border rounded-lg border border-border bg-surface">
          {(query.data ?? []).map((flag) => {
            const value = currentValue(flag, scope);
            const description = descriptionFor(KNOWN_POWER_FLAGS, flag.flag);
            return (
              <article
                key={flag.flag}
                className="flex flex-wrap items-center justify-between gap-4 px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm text-foreground">
                      {labelFor(KNOWN_POWER_FLAGS, flag.flag)}
                    </p>
                    {flag.sovereign ? (
                      <StubBadge tone="danger">{pickByLocale(locale, S.sovereignLocked)}</StubBadge>
                    ) : null}
                    {flag.readError ? (
                      <StubBadge tone="warn">{pickByLocale(locale, S.readError)}</StubBadge>
                    ) : null}
                  </div>
                  <p className="font-mono text-xs text-muted-foreground">{flag.flag}</p>
                  {description ? (
                    <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <StubBadge tone={value === true ? 'success' : value === false ? 'neutral' : 'info'}>
                    {value === null
                      ? pickByLocale(locale, S.unset)
                      : value
                        ? pickByLocale(locale, S.on)
                        : pickByLocale(locale, S.off)}
                  </StubBadge>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      disabled={flag.sovereign || mutation.isPending || value === true}
                      onClick={() => toggle(flag, true)}
                      className="rounded-md border border-border px-2 py-1 text-xs text-success hover:bg-surface-sunken disabled:opacity-40"
                    >
                      {pickByLocale(locale, S.enable)}
                    </button>
                    <button
                      type="button"
                      disabled={flag.sovereign || mutation.isPending || value === false}
                      onClick={() => toggle(flag, false)}
                      className="rounded-md border border-border px-2 py-1 text-xs text-warning hover:bg-surface-sunken disabled:opacity-40"
                    >
                      {pickByLocale(locale, S.disable)}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <div className="w-64">
          <Input
            type="text"
            value={newFlag}
            onChange={(e) => setNewFlag(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addFlag();
            }}
            placeholder={pickByLocale(locale, S.addPlaceholder)}
            aria-label={pickByLocale(locale, S.addFlagAria)}
            className="font-mono text-xs"
          />
        </div>
        <Button type="button" variant="outline" size="sm" onClick={addFlag}>
          {pickByLocale(locale, S.addFlag)}
        </Button>
      </div>

      <Toast
        message={toast}
        tone={mutation.isError ? 'danger' : 'success'}
        onDismiss={() => setToast(null)}
      />
    </div>
  );
}
