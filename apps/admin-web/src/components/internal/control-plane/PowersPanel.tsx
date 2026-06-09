'use client';

import { useMemo, useState } from 'react';
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

const FLAG_RE = /^[a-z][a-z0-9_]*$/;

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
export function PowersPanel(): JSX.Element {
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
      setToast('Flag must be snake_case (a-z, 0-9, _).');
      return;
    }
    if (flagNames.includes(candidate)) {
      setToast('Flag already in the list.');
      return;
    }
    setExtraFlags((prev) => [...prev, candidate]);
    setNewFlag('');
  }

  function toggle(flag: PowerFlag, next: boolean) {
    if (flag.sovereign) return;
    if (!reasonValid) {
      setToast('Enter a reason (≥ 8 chars) before changing a power flag.');
      return;
    }
    mutation.mutate(
      { flag: flag.flag, enabled: next, scope, reason: reason.trim() },
      {
        onSuccess: (res) =>
          setToast(
            `${res.flag} → ${res.enabled ? 'on' : 'off'} (${res.scope})${
              res.journalId ? ` · audit ${res.journalId.slice(0, 8)}…` : ''
            }`,
          ),
        onError: (err) => setToast(`Failed: ${err.message}`),
      },
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <ScopeSelector scope={scope} onChange={setScope} />
        <StubBadge tone="info">
          {scope === 'global' ? 'Platform-wide default' : 'Tenant override'}
        </StubBadge>
      </div>

      <label className="block">
        <span className="mb-1 block text-xs uppercase tracking-wider text-neutral-500">
          Reason (audited, required for every write)
        </span>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why are you changing this power?"
          className={`w-full rounded-md border bg-surface-sunken px-3 py-2 text-sm text-foreground placeholder:text-neutral-600 focus:outline-none ${
            reason.length === 0 || reasonValid
              ? 'border-border focus:border-signal-500'
              : 'border-danger/60'
          }`}
        />
      </label>

      {query.isPending ? (
        <p className="text-sm text-neutral-500">Loading powers…</p>
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
                      <StubBadge tone="danger">Sovereign · locked</StubBadge>
                    ) : null}
                    {flag.readError ? (
                      <StubBadge tone="warn">Read error</StubBadge>
                    ) : null}
                  </div>
                  <p className="font-mono text-xs text-neutral-500">{flag.flag}</p>
                  {description ? (
                    <p className="mt-0.5 text-xs text-neutral-400">{description}</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <StubBadge tone={value === true ? 'success' : value === false ? 'neutral' : 'info'}>
                    {value === null ? 'unset' : value ? 'On' : 'Off'}
                  </StubBadge>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      disabled={flag.sovereign || mutation.isPending || value === true}
                      onClick={() => toggle(flag, true)}
                      className="rounded-md border border-border px-2 py-1 text-xs text-success hover:bg-surface-sunken disabled:opacity-40"
                    >
                      Enable
                    </button>
                    <button
                      type="button"
                      disabled={flag.sovereign || mutation.isPending || value === false}
                      onClick={() => toggle(flag, false)}
                      className="rounded-md border border-border px-2 py-1 text-xs text-warning hover:bg-surface-sunken disabled:opacity-40"
                    >
                      Disable
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={newFlag}
          onChange={(e) => setNewFlag(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') addFlag();
          }}
          placeholder="add_flag_name"
          aria-label="Add a flag to manage"
          className="w-64 rounded-md border border-border bg-surface-sunken px-3 py-1.5 font-mono text-xs text-foreground placeholder:text-neutral-600 focus:border-signal-500 focus:outline-none"
        />
        <button
          type="button"
          onClick={addFlag}
          className="rounded-md border border-border px-3 py-1.5 text-xs text-neutral-300 hover:bg-surface"
        >
          Add flag
        </button>
      </div>

      <Toast
        message={toast}
        tone={mutation.isError ? 'danger' : 'success'}
        onDismiss={() => setToast(null)}
      />
    </div>
  );
}
