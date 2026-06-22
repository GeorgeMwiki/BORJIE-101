'use client';

/**
 * DecisionTrace detail (admin replay UI) — INV-A / FIRE-2.
 *
 * Two trust tiers, mirroring the gateway:
 *   - METADATA header (always): id, action, outcome, tenant, timing, ids —
 *     `GET /mining/internal/decision-trace/:id`.
 *   - CONTENT (break-glass): inputs / branches / rationale / output /
 *     attributes — `GET /mining/internal/decision-trace/:id/content?tenant=`.
 *     Deny-by-default: the gateway returns 403 BREAK_GLASS_REQUIRED until the
 *     tenant has consented to a time-boxed grant. This UI lets an operator
 *     file the request (`POST /mining/internal/break-glass/requests`) and,
 *     once the tenant consents on owner-web, fetch the content (every read is
 *     hash-chain audited + tenant-visible).
 *
 * No SUPABASE_SERVICE_ROLE_KEY anywhere — auth is the platform-session cookie.
 *
 * Rendered on design-system primitives + semantic tokens. SINGLE LANGUAGE
 * PER LOCALE (canon): every user-facing string resolves to the active
 * locale via `pickByLocale`. Purely client surface — the hook falls back to
 * the project default and the post-mount effect corrects it.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Button, Card, Skeleton, Alert, FormField, Input } from '@borjie/design-system';
import { api } from '@/lib/api';
import { useLocale, pickByLocale } from '@/lib/locale';

interface TraceMeta {
  readonly id: string;
  readonly tenantId: string | null;
  readonly name: string;
  readonly startedAt: string;
  readonly finalisedAt: string;
  readonly durationMs: number;
  readonly outcome: string;
  readonly chosenBranchId: string | null;
  readonly userId: string | null;
  readonly requestId: string | null;
  readonly parentTraceId: string | null;
}

interface TraceContent extends TraceMeta {
  readonly inputs: Record<string, unknown>;
  readonly branches: ReadonlyArray<Record<string, unknown>>;
  readonly chosenRationale: string | null;
  readonly attributes: Record<string, unknown>;
  readonly output: unknown;
  readonly error: string | null;
}

const S = {
  notFound: { en: 'Trace not found', sw: 'Ufuatiliaji haukupatikana' },
  noTenantScope: {
    en: 'This is a platform-tier trace with no tenant scope.',
    sw: 'Huu ni ufuatiliaji wa kiwango cha jukwaa bila wigo wa mteja.',
  },
  breakGlassRequired: {
    en: 'Break-glass required — the tenant must consent to a time-boxed grant before content is shown.',
    sw: 'Ufikiaji wa dharura unahitajika — mteja lazima aidhinishe ruhusa ya muda kabla maudhui hayajaonyeshwa.',
  },
  filed: {
    en: 'Break-glass request filed. The tenant will see it on their Trust Center and must consent before content unlocks. Retry once consented.',
    sw: 'Ombi la ufikiaji wa dharura limewasilishwa. Mteja ataliona kwenye Kituo cha Uaminifu na lazima aidhinishe kabla maudhui hayajafunguliwa. Jaribu tena baada ya idhini.',
  },
  fileFailed: {
    en: 'Failed to file break-glass request',
    sw: 'Imeshindwa kuwasilisha ombi la ufikiaji wa dharura',
  },
  back: { en: '← Back to list', sw: '← Rudi kwenye orodha' },
  action: { en: 'Action', sw: 'Kitendo' },
  outcome: { en: 'Outcome', sw: 'Matokeo' },
  tenant: { en: 'Tenant', sw: 'Mteja' },
  platform: { en: 'platform', sw: 'jukwaa' },
  duration: { en: 'Duration', sw: 'Muda' },
  contentIsTenant: {
    en: 'Decision content is tenant business data',
    sw: 'Maudhui ya uamuzi ni data ya biashara ya mteja',
  },
  contentExplain: {
    en: 'Inputs, branches, rationale, and output cross the control-plane wall. They are shown only under an active, tenant-consented, time-boxed break-glass grant — every read is hash-chain audited and visible to the tenant.',
    sw: 'Ingizo, matawi, hoja, na matokeo huvuka ukuta wa udhibiti. Huonyeshwa tu chini ya ruhusa ya dharura iliyo hai, iliyoidhinishwa na mteja, ya muda — kila usomaji hukaguliwa kwa mnyororo wa heshi na huonekana kwa mteja.',
  },
  justification: { en: 'Justification / reason', sw: 'Uhalali / sababu' },
  filing: { en: 'Filing…', sw: 'Inawasilisha…' },
  requestBg: { en: 'Request break-glass', sw: 'Omba ufikiaji wa dharura' },
  checking: { en: 'Checking…', sw: 'Inaangalia…' },
  loadContent: { en: 'Load content', sw: 'Pakia maudhui' },
  platformNoBg: {
    en: 'Platform-tier trace — no tenant scope, no break-glass needed (and no tenant content to show).',
    sw: 'Ufuatiliaji wa kiwango cha jukwaa — hakuna wigo wa mteja, hakuna ufikiaji wa dharura unaohitajika (na hakuna maudhui ya mteja ya kuonyesha).',
  },
  inputs: { en: 'Inputs', sw: 'Ingizo' },
  branchesConsidered: { en: 'Branches considered', sw: 'Matawi yaliyozingatiwa' },
  rationale: { en: 'Rationale', sw: 'Hoja' },
  error: { en: 'Error', sw: 'Hitilafu' },
  output: { en: 'Output', sw: 'Matokeo' },
  attributes: { en: 'Attributes', sw: 'Sifa' },
} as const;

function json(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function DecisionTraceDetailClient({
  traceId,
  tenant,
}: {
  traceId: string;
  tenant: string | null;
}) {
  const locale = useLocale();
  const [meta, setMeta] = useState<TraceMeta | null>(null);
  const [content, setContent] = useState<TraceContent | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [contentState, setContentState] = useState<
    'idle' | 'locked' | 'loading' | 'error'
  >('idle');
  const [contentMsg, setContentMsg] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [requesting, setRequesting] = useState(false);

  useEffect(() => {
    void (async () => {
      const res = await api.get<TraceMeta>(
        `/mining/internal/decision-trace/${encodeURIComponent(traceId)}`,
      );
      if (res.success && res.data) setMeta(res.data);
      else setMetaError(res.error ?? pickByLocale(locale, S.notFound));
    })();
  }, [traceId, locale]);

  const fetchContent = useCallback(async () => {
    if (!tenant) {
      setContentState('error');
      setContentMsg(pickByLocale(locale, S.noTenantScope));
      return;
    }
    setContentState('loading');
    const res = await api.get<TraceContent>(
      `/mining/internal/decision-trace/${encodeURIComponent(
        traceId,
      )}/content?tenant=${encodeURIComponent(tenant)}`,
    );
    if (res.success && res.data) {
      setContent(res.data);
      setContentState('idle');
      setContentMsg(null);
    } else {
      setContentState('locked');
      setContentMsg(res.error ?? pickByLocale(locale, S.breakGlassRequired));
    }
  }, [traceId, tenant, locale]);

  const requestAccess = useCallback(async () => {
    if (!tenant) return;
    setRequesting(true);
    const res = await api.post('/mining/internal/break-glass/requests', {
      tenantId: tenant,
      justificationCode: 'incident_response',
      reason: reason || `decision-trace replay ${traceId}`,
      scopes: ['decision_trace_content'],
    });
    setRequesting(false);
    if (res.success) {
      setContentMsg(pickByLocale(locale, S.filed));
    } else {
      setContentMsg(res.error ?? pickByLocale(locale, S.fileFailed));
    }
  }, [tenant, reason, traceId, locale]);

  if (metaError) {
    return <Alert variant="error">{metaError}</Alert>;
  }
  if (!meta) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full rounded-lg border border-border" />
        <Skeleton className="h-40 w-full rounded-lg border border-border" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-xs">
        <Link
          href="/decision-trace"
          className="text-info hover:underline"
        >
          {pickByLocale(locale, S.back)}
        </Link>
      </div>

      <Card variant="outline" className="p-5">
        <div className="flex flex-wrap justify-between gap-4">
          <Meta label={pickByLocale(locale, S.action)} value={meta.name} mono />
          <Meta
            label={pickByLocale(locale, S.outcome)}
            value={meta.outcome.toUpperCase()}
            mono
          />
          <Meta
            label={pickByLocale(locale, S.tenant)}
            value={meta.tenantId ?? pickByLocale(locale, S.platform)}
            mono
          />
          <Meta
            label={pickByLocale(locale, S.duration)}
            value={`${meta.durationMs}ms`}
            mono
          />
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 font-mono text-xs text-muted-foreground md:grid-cols-3">
          <div>id: {meta.id}</div>
          <div>started: {new Date(meta.startedAt).toISOString()}</div>
          <div>finalised: {new Date(meta.finalisedAt).toISOString()}</div>
          {meta.userId ? <div>userId: {meta.userId}</div> : null}
          {meta.requestId ? <div>requestId: {meta.requestId}</div> : null}
        </div>
      </Card>

      {!content ? (
        <Card className="space-y-3 border-warning/30 bg-warning-subtle p-5">
          <h2 className="text-sm font-medium text-warning">
            {pickByLocale(locale, S.contentIsTenant)}
          </h2>
          <p className="text-xs text-muted-foreground">
            {pickByLocale(locale, S.contentExplain)}
          </p>
          {contentMsg && <p className="text-xs text-warning">{contentMsg}</p>}
          <div className="flex flex-wrap items-end gap-2">
            <FormField
              label={pickByLocale(locale, S.justification)}
              name="reason"
              className="min-w-64 flex-1"
            >
              <Input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="incident ref / ticket id"
              />
            </FormField>
            <Button
              type="button"
              variant="warning"
              onClick={() => void requestAccess()}
              disabled={!tenant}
              loading={requesting}
            >
              {pickByLocale(locale, S.requestBg)}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void fetchContent()}
              disabled={!tenant}
              loading={contentState === 'loading'}
            >
              {pickByLocale(locale, S.loadContent)}
            </Button>
          </div>
          {!tenant && (
            <p className="text-xs text-muted-foreground">
              {pickByLocale(locale, S.platformNoBg)}
            </p>
          )}
        </Card>
      ) : (
        <>
          <Panel
            title={pickByLocale(locale, S.inputs)}
            body={json(content.inputs ?? {})}
          />
          <Panel
            title={`${pickByLocale(locale, S.branchesConsidered)} (${content.branches?.length ?? 0})`}
            body={json(content.branches ?? [])}
          />
          {content.chosenRationale ? (
            <div className="text-xs text-muted-foreground">
              {pickByLocale(locale, S.rationale)}: {content.chosenRationale}
            </div>
          ) : null}
          {content.error ? (
            <Panel
              title={pickByLocale(locale, S.error)}
              body={content.error}
              tone="error"
            />
          ) : null}
          <Panel
            title={pickByLocale(locale, S.output)}
            body={json(content.output ?? null)}
          />
          {content.attributes &&
          Object.keys(content.attributes).length > 0 ? (
            <Panel
              title={pickByLocale(locale, S.attributes)}
              body={json(content.attributes)}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

function Meta({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={`text-sm text-foreground ${mono ? 'font-mono' : ''}`}>
        {value}
      </div>
    </div>
  );
}

function Panel({
  title,
  body,
  tone,
}: {
  title: string;
  body: string;
  tone?: 'error';
}) {
  return (
    <section>
      <h2
        className={`mb-2 text-sm font-medium ${
          tone === 'error' ? 'text-danger' : 'text-foreground'
        }`}
      >
        {title}
      </h2>
      <pre
        className={`overflow-x-auto rounded p-4 text-xs ${
          tone === 'error'
            ? 'border border-danger/40 bg-danger-subtle text-danger'
            : 'border border-border bg-surface-sunken text-foreground'
        }`}
      >
        {body}
      </pre>
    </section>
  );
}
