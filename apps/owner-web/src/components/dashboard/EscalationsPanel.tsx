'use client';

/**
 * EscalationsPanel — the human-CLOSING surface for the manager-dispatch
 * escalation ladder, native to owner-web's cockpit.
 *
 * Reads the AUTHORITATIVE `mining_escalations` table (the never-drop
 * ladder rung-4 dispatcher and the `/api/v1/mining/escalations` route
 * both write it) through the mounted gateway GET, and wires the
 * Acknowledge / Resolve closing calls (`POST /:id/acknowledge`,
 * `/:id/resolve`) — making the CLOSING stage reachable for a real owner
 * in the BUILT app for the first time.
 *
 * Single language per render (the `languagePreference` prop selects ONE
 * dictionary; en + sw never mix). Mirrors `OwnerOSRemindersPanel`'s
 * `makeT(dictionaries[locale])` + cockpit-card conventions.
 *
 * Supersedes the un-integrated `src/features/central-command` port whose
 * `@/` imports resolve nowhere and which is excluded from every build.
 *
 * @module components/dashboard/EscalationsPanel
 */

import { useMemo, type ReactElement } from 'react';
import { Button, Card } from '@borjie/design-system';
import { dictionaries } from '@/i18n/dictionaries';
import { makeT, type TFn } from '@/i18n/resolve';
import { useLocale } from '@/lib/locale';
import { useEscalations, type EscalationAction } from '@/lib/useEscalations';
import {
  type EscalationSeverity,
  type EscalationStatus,
  type MiningEscalationRow,
} from '@/lib/escalations-client';

export interface EscalationsPanelProps {
  /**
   * Optional explicit locale override (single language — never mixed). When
   * omitted the panel reads the active locale via `useLocale()`, matching
   * its dashboard sibling `NotificationsInbox`.
   */
  readonly languagePreference?: 'sw' | 'en';
  /**
   * When false the panel does not query (e.g. signed-out / no tenant
   * resolved). Defaults to true; the gateway enforces tenant + user scope.
   */
  readonly enabled?: boolean;
}

const SEVERITY_PILL: Record<EscalationSeverity, string> = {
  critical: 'pill-red',
  warning: 'pill-amber',
  info: 'border-border text-neutral-400',
};

function severityLabel(t: TFn, s: EscalationSeverity): string {
  return t(`escalations.severity${s.charAt(0).toUpperCase()}${s.slice(1)}`);
}

function statusLabel(t: TFn, s: EscalationStatus): string {
  return t(`escalations.status${s.charAt(0).toUpperCase()}${s.slice(1)}`);
}

/** Locale-aware relative age; falls back to a localized date string. */
function formatAge(iso: string, t: TFn): string {
  const parsed = new Date(iso).getTime();
  if (Number.isNaN(parsed)) return iso;
  const ms = Date.now() - parsed;
  if (ms < 60_000) return t('escalations.justNow');
  if (ms < 60 * 60_000) {
    return t('escalations.minutesAgo', { count: Math.round(ms / 60_000) });
  }
  if (ms < 24 * 60 * 60_000) {
    return t('escalations.hoursAgo', { count: Math.round(ms / 3_600_000) });
  }
  return new Date(parsed).toLocaleDateString();
}

export function EscalationsPanel({
  languagePreference,
  enabled = true,
}: EscalationsPanelProps): ReactElement {
  const activeLocale = useLocale();
  const locale = languagePreference ?? activeLocale;
  const t = useMemo(() => makeT(dictionaries[locale]), [locale]);
  const {
    rows,
    isLoading,
    loadError,
    actionError,
    pendingId,
    pendingAction,
    act,
  } = useEscalations(enabled);

  return (
    <Card
      hoverable
      className="flex flex-col gap-4 p-5"
      data-testid="dashboard-escalations"
    >
      <header className="flex items-baseline justify-between">
        <div>
          <h2 className="cockpit-card-title">{t('escalations.heading')}</h2>
          <p className="text-xs text-neutral-500">{t('escalations.liveHint')}</p>
        </div>
        {!isLoading && !loadError && enabled ? (
          <span className="pill border-border text-neutral-400">
            {t('escalations.headerOpen', { count: rows.length })}
          </span>
        ) : null}
      </header>

      {!enabled ? (
        <Banner tone="status">{t('escalations.signInRequired')}</Banner>
      ) : isLoading ? (
        <Banner tone="status">{t('escalations.loading')}</Banner>
      ) : loadError ? (
        <Banner tone="error">{t('escalations.loadFailed')}</Banner>
      ) : rows.length === 0 ? (
        <div data-testid="dashboard-escalations-empty">
          <p className="text-sm font-medium text-foreground">
            {t('escalations.emptyTitle')}
          </p>
          <p className="mt-1 text-sm text-neutral-400">
            {t('escalations.emptyBody')}
          </p>
        </div>
      ) : (
        <>
          {actionError ? (
            <Banner tone="error">{t('escalations.actionFailed')}</Banner>
          ) : null}
          <ul className="flex flex-col gap-3">
            {rows.map((row) => (
              <EscalationRow
                key={row.id}
                row={row}
                t={t}
                anyPending={pendingId !== null}
                busyAction={pendingId === row.id ? pendingAction : null}
                onAct={act}
              />
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

function EscalationRow(props: {
  readonly row: MiningEscalationRow;
  readonly t: TFn;
  readonly anyPending: boolean;
  readonly busyAction: EscalationAction | null;
  readonly onAct: (id: string, action: EscalationAction) => void;
}): ReactElement {
  const { row, t, anyPending, busyAction, onAct } = props;
  const ackLabel =
    busyAction === 'acknowledge'
      ? t('escalations.acknowledging')
      : t('escalations.acknowledge');
  const resolveLabel =
    busyAction === 'resolve'
      ? t('escalations.resolving')
      : t('escalations.resolve');
  return (
    <li
      data-testid={`dashboard-escalation-row-${row.id}`}
      className="rounded-xl border border-border bg-surface px-4 py-3"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 flex-1 text-sm text-foreground">
          {row.contextSw}
        </p>
        <div className="flex shrink-0 items-center gap-1">
          <span className={`pill ${SEVERITY_PILL[row.severity]}`}>
            {severityLabel(t, row.severity)}
          </span>
          <span className="pill border-border text-neutral-400">
            {statusLabel(t, row.status)}
          </span>
        </div>
      </div>
      <p className="mt-1 text-xs text-neutral-500">
        {t('escalations.openedPrefix')} {formatAge(row.createdAt, t)}
      </p>
      <div className="mt-2 flex items-center justify-end gap-2">
        {row.status === 'open' ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={anyPending}
            loading={busyAction === 'acknowledge'}
            onClick={() => onAct(row.id, 'acknowledge')}
          >
            {ackLabel}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={anyPending}
          loading={busyAction === 'resolve'}
          onClick={() => onAct(row.id, 'resolve')}
          className="border-success/40 bg-success/10 text-success hover:bg-success/20 hover:text-success"
        >
          {resolveLabel}
        </Button>
      </div>
    </li>
  );
}

function Banner(props: {
  readonly tone: 'error' | 'status';
  readonly children: React.ReactNode;
}): ReactElement {
  const cls =
    props.tone === 'error'
      ? 'rounded border border-warning/40 bg-warning-subtle/10 px-4 py-3 text-sm text-warning'
      : 'rounded border border-border bg-surface/40 px-4 py-3 text-sm text-neutral-400';
  return (
    <div role={props.tone === 'error' ? 'alert' : 'status'} className={cls}>
      {props.children}
    </div>
  );
}
