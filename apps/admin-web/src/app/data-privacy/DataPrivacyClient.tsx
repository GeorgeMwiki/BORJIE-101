'use client';

/**
 * GDPR right-to-be-forgotten — migrated from
 * apps/admin-portal/src/pages/DataPrivacy.tsx.
 *
 *   POST /api/v1/gdpr/delete-request           — lodge a deletion request
 *   GET  /api/v1/gdpr/delete-request/:id       — poll for status
 *   POST /api/v1/gdpr/delete-request/:id/execute?tenant=… — break-glass exec
 *
 * INV-A / FIRE-5: RTBF EXECUTION deletes a tenant's PII from this internal
 * console. It is now bound to the break-glass spine — a platform operator must
 * have an active, tenant-consented, time-boxed grant (scope `rtbf_execution`)
 * for the TARGET tenant before the gateway will execute. The execution is
 * hash-chain audited and surfaced on the tenant's owner-web Trust Center. The
 * operator files the request here; the gateway enforces the gate.
 *
 * Rendered on design-system primitives + semantic tokens. SINGLE LANGUAGE
 * PER LOCALE (canon): every user-facing string resolves to the active
 * locale via `pickByLocale`. Purely client surface — the hook falls back to
 * the project default and the post-mount effect corrects it.
 */

import { useCallback, useState } from 'react';
import { Lock, Shield, Download, AlertTriangle } from 'lucide-react';
import {
  Button,
  Card,
  Alert,
  FormField,
  Input,
  Textarea,
} from '@borjie/design-system';
import { api } from '@/lib/api';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';

interface DeleteRequestRecord {
  readonly id: string;
  readonly customerId: string;
  readonly status: string;
  readonly createdAt: string;
  readonly executedAt?: string | null;
  readonly notes?: string;
}

const S = {
  intro: {
    en: 'Lodge GDPR right-to-be-forgotten requests and execute approved deletions.',
    sw: 'Wasilisha maombi ya haki-ya-kusahaulika ya GDPR na tekeleza ufutaji ulioidhinishwa.',
  },
  recordFailed: { en: 'Failed to record request', sw: 'Imeshindwa kurekodi ombi' },
  lookupFailed: { en: 'Lookup failed', sw: 'Utafutaji umeshindwa' },
  tenantRequiredBg: {
    en: 'A target tenant id is required to request break-glass.',
    sw: 'Kitambulisho cha mteja lengwa kinahitajika kuomba ufikiaji wa dharura.',
  },
  tenantRequiredExec: {
    en: 'A target tenant id is required to execute (break-glass scope).',
    sw: 'Kitambulisho cha mteja lengwa kinahitajika kutekeleza (wigo wa ufikiaji wa dharura).',
  },
  recorded: {
    en: 'Request recorded with status',
    sw: 'Ombi limerekodiwa likiwa na hali',
  },
  bgFiled: {
    en: 'Break-glass request filed. The tenant must consent on their Trust Center before execution will run. Retry execution once consented.',
    sw: 'Ombi la ufikiaji wa dharura limewasilishwa. Mteja lazima aidhinishe kwenye Kituo cha Uaminifu kabla utekelezaji haujaanza. Jaribu tena baada ya idhini.',
  },
  bgFailed: {
    en: 'Failed to file break-glass request',
    sw: 'Imeshindwa kuwasilisha ombi la ufikiaji wa dharura',
  },
  executed: {
    en: 'Deletion executed under break-glass (audited + tenant-visible).',
    sw: 'Ufutaji umetekelezwa chini ya ufikiaji wa dharura (umekaguliwa + unaonekana kwa mteja).',
  },
  execFailed: {
    en: 'Failed to execute deletion — an active tenant-consented break-glass grant is required.',
    sw: 'Imeshindwa kutekeleza ufutaji — ruhusa hai ya ufikiaji wa dharura iliyoidhinishwa na mteja inahitajika.',
  },
  newRequest: { en: 'New deletion request', sw: 'Ombi jipya la ufutaji' },
  customerId: { en: 'Customer ID', sw: 'Kitambulisho cha mteja' },
  targetTenant: { en: 'Target tenant id', sw: 'Kitambulisho cha mteja lengwa' },
  targetTenantPlaceholder: {
    en: 'tenant_… (required for break-glass execution)',
    sw: 'tenant_… (inahitajika kwa utekelezaji wa dharura)',
  },
  notes: { en: 'Notes', sw: 'Maelezo' },
  submitRequest: { en: 'Submit deletion request', sw: 'Wasilisha ombi la ufutaji' },
  lookup: { en: 'Look up request', sw: 'Tafuta ombi' },
  requestId: { en: 'Request ID', sw: 'Kitambulisho cha ombi' },
  fetchStatus: { en: 'Fetch status', sw: 'Pata hali' },
  request: { en: 'Request', sw: 'Ombi' },
  customer: { en: 'Customer', sw: 'Mteja' },
  status: { en: 'Status', sw: 'Hali' },
  created: { en: 'Created', sw: 'Imeundwa' },
  executedLabel: { en: 'Executed', sw: 'Imetekelezwa' },
  requestBg: { en: 'Request break-glass', sw: 'Omba ufikiaji wa dharura' },
  executeDeletion: {
    en: 'Execute deletion (break-glass)',
    sw: 'Tekeleza ufutaji (ufikiaji wa dharura)',
  },
} as const;

// RTBF request status arrives as an open machine token. Map the known
// lifecycle values to per-locale labels; an unknown token falls back to the
// raw (locale-neutral) string rather than ever rendering a foreign word.
const STATUS_LABEL: Record<string, { en: string; sw: string }> = {
  pending: { en: 'pending', sw: 'inasubiri' },
  approved: { en: 'approved', sw: 'imeidhinishwa' },
  executed: { en: 'executed', sw: 'imetekelezwa' },
  rejected: { en: 'rejected', sw: 'imekataliwa' },
  failed: { en: 'failed', sw: 'imeshindwa' },
};

function statusLabel(status: string, locale: Locale): string {
  const entry = STATUS_LABEL[status.toLowerCase()];
  return entry ? pickByLocale(locale, entry) : status;
}

export function DataPrivacyClient({ initialLocale }: { readonly initialLocale?: Locale } = {}) {
  const locale = useLocale(initialLocale);
  const [customerId, setCustomerId] = useState('');
  const [notes, setNotes] = useState('');
  const [targetTenantId, setTargetTenantId] = useState('');
  const [record, setRecord] = useState<DeleteRequestRecord | null>(null);
  const [lookupId, setLookupId] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requestingGrant, setRequestingGrant] = useState(false);

  const submit = useCallback(async () => {
    setLoading(true);
    setError(null);
    setMessage(null);
    const res = await api.post<DeleteRequestRecord>('/gdpr/delete-request', {
      customerId,
      notes: notes || undefined,
    });
    setLoading(false);
    if (res.success && res.data) {
      setRecord(res.data);
      setMessage(
        `${pickByLocale(locale, S.request)} ${res.data.id} — ${pickByLocale(locale, S.recorded)} ${statusLabel(res.data.status, locale)}.`,
      );
    } else {
      setError(res.error ?? pickByLocale(locale, S.recordFailed));
    }
  }, [customerId, notes, locale]);

  const lookup = useCallback(async () => {
    if (!lookupId) return;
    setLoading(true);
    setError(null);
    const res = await api.get<DeleteRequestRecord>(
      `/gdpr/delete-request/${encodeURIComponent(lookupId)}`,
    );
    setLoading(false);
    if (res.success && res.data) {
      setRecord(res.data);
    } else {
      setError(res.error ?? pickByLocale(locale, S.lookupFailed));
    }
  }, [lookupId, locale]);

  const requestBreakGlass = useCallback(async () => {
    if (!targetTenantId) {
      setError(pickByLocale(locale, S.tenantRequiredBg));
      return;
    }
    setRequestingGrant(true);
    setError(null);
    setMessage(null);
    const res = await api.post('/mining/internal/break-glass/requests', {
      tenantId: targetTenantId,
      justificationCode: 'rtbf_execution',
      reason: `RTBF execution${record ? ` for request ${record.id}` : ''}`,
      scopes: ['rtbf_execution'],
    });
    setRequestingGrant(false);
    if (res.success) {
      setMessage(pickByLocale(locale, S.bgFiled));
    } else {
      setError(res.error ?? pickByLocale(locale, S.bgFailed));
    }
  }, [targetTenantId, record, locale]);

  const execute = useCallback(async () => {
    if (!record) return;
    if (!targetTenantId) {
      setError(pickByLocale(locale, S.tenantRequiredExec));
      return;
    }
    setLoading(true);
    setError(null);
    const res = await api.post<DeleteRequestRecord>(
      `/gdpr/delete-request/${encodeURIComponent(record.id)}/execute?tenant=${encodeURIComponent(targetTenantId)}`,
      {},
    );
    setLoading(false);
    if (res.success && res.data) {
      setRecord(res.data);
      setMessage(pickByLocale(locale, S.executed));
    } else {
      setError(res.error ?? pickByLocale(locale, S.execFailed));
    }
  }, [record, targetTenantId, locale]);

  return (
    <div className="max-w-3xl space-y-6">
      <header className="flex items-center gap-3">
        <Lock className="h-6 w-6 text-danger" />
        <p className="text-sm text-muted-foreground">
          {pickByLocale(locale, S.intro)}
        </p>
      </header>

      {message && <Alert variant="success">{message}</Alert>}
      {error && (
        <Alert variant="error">
          <span className="inline-flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4" /> {error}
          </span>
        </Alert>
      )}

      <Card className="space-y-3 rounded-2xl p-6 transition-colors hover:border-border-strong">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-danger" />
          <h3 className="font-display text-foreground">
            {pickByLocale(locale, S.newRequest)}
          </h3>
        </div>
        <FormField label={pickByLocale(locale, S.customerId)} name="customerId">
          <Input
            type="text"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            placeholder="cust_…"
            data-testid="gdpr-customer-id"
          />
        </FormField>
        <FormField
          label={pickByLocale(locale, S.targetTenant)}
          name="targetTenant"
        >
          <Input
            type="text"
            value={targetTenantId}
            onChange={(e) => setTargetTenantId(e.target.value)}
            placeholder={pickByLocale(locale, S.targetTenantPlaceholder)}
            data-testid="gdpr-target-tenant"
          />
        </FormField>
        <FormField label={pickByLocale(locale, S.notes)} name="notes">
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
          />
        </FormField>
        <Button
          type="button"
          variant="destructive"
          onClick={() => void submit()}
          disabled={!customerId}
          loading={loading}
        >
          {pickByLocale(locale, S.submitRequest)}
        </Button>
      </Card>

      <Card className="space-y-3 rounded-2xl p-6 transition-colors hover:border-border-strong">
        <div className="flex items-center gap-2">
          <Download className="h-4 w-4 text-info" />
          <h3 className="font-display text-foreground">
            {pickByLocale(locale, S.lookup)}
          </h3>
        </div>
        <div className="flex items-end gap-2">
          <FormField
            label={pickByLocale(locale, S.requestId)}
            name="lookupId"
            className="flex-1"
          >
            <Input
              type="text"
              value={lookupId}
              onChange={(e) => setLookupId(e.target.value)}
              placeholder={pickByLocale(locale, S.requestId)}
            />
          </FormField>
          <Button
            type="button"
            variant="outline"
            onClick={() => void lookup()}
            disabled={!lookupId}
            loading={loading}
          >
            {pickByLocale(locale, S.fetchStatus)}
          </Button>
        </div>
      </Card>

      {record && (
        <Card className="space-y-2 rounded-2xl p-6 text-sm text-foreground transition-colors hover:border-border-strong">
          <p className="font-display text-foreground">
            {pickByLocale(locale, S.request)} {record.id}
          </p>
          <p>
            {pickByLocale(locale, S.customer)}: {record.customerId}
          </p>
          <p>
            {pickByLocale(locale, S.status)}: {statusLabel(record.status, locale)}
          </p>
          <p>
            {pickByLocale(locale, S.created)}: {record.createdAt}
          </p>
          {record.executedAt && (
            <p>
              {pickByLocale(locale, S.executedLabel)}: {record.executedAt}
            </p>
          )}
          {record.notes && (
            <p>
              {pickByLocale(locale, S.notes)}: {record.notes}
            </p>
          )}
          {record.status !== 'executed' && (
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="warning"
                onClick={() => void requestBreakGlass()}
                disabled={!targetTenantId}
                loading={requestingGrant}
              >
                {pickByLocale(locale, S.requestBg)}
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => void execute()}
                disabled={!targetTenantId}
              >
                {pickByLocale(locale, S.executeDeletion)}
              </Button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
