'use client';

/**
 * Agent certifications admin — migrated from
 * apps/admin-portal/src/pages/ApiIntegrations.tsx.
 *
 *   GET    /api/v1/agent-certifications
 *   POST   /api/v1/agent-certifications
 *   DELETE /api/v1/agent-certifications/:id
 *   GET    /api/v1/agent-certifications/revocations
 *
 * Rendered on design-system primitives + semantic tokens. The hand-rolled
 * `role="alertdialog"` revoke confirm is now a focus-trapped DS Modal.
 * SINGLE LANGUAGE PER LOCALE (canon): every user-facing string resolves to
 * the active locale via `pickByLocale`. Purely client surface — the hook
 * falls back to the project default and the post-mount effect corrects it.
 */

import { useCallback, useEffect, useState } from 'react';
import { KeyRound, Plus, Trash2 } from 'lucide-react';
import {
  Button,
  Card,
  Skeleton,
  Alert,
  Empty,
  FormField,
  Input,
  Modal,
  ModalBody,
  ModalFooter,
} from '@borjie/design-system';
import { api } from '@/lib/api';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';
import { formatDateTime } from '@/lib/format';

interface Certification {
  readonly id: string;
  readonly agentId: string;
  readonly scopes: readonly string[];
  readonly expiresAt: string;
  readonly createdAt: string;
  readonly revokedAt?: string | null;
}

interface Revocation {
  readonly id: string;
  readonly certId: string;
  readonly reason: string;
  readonly revokedAt: string;
}

const S = {
  intro: {
    en: 'Issue, view, and revoke agent certifications used by external integrators.',
    sw: 'Toa, ona, na batilisha vyeti vya wakala vinavyotumika na waunganishaji wa nje.',
  },
  loadFailed: { en: 'Failed to load certifications', sw: 'Imeshindwa kupakia vyeti' },
  issueFailed: { en: 'Failed to issue certification', sw: 'Imeshindwa kutoa cheti' },
  revokeFailed: { en: 'Failed to revoke', sw: 'Imeshindwa kubatilisha' },
  issueNew: { en: 'Issue new certification', sw: 'Toa cheti kipya' },
  agentId: { en: 'Agent ID', sw: 'Kitambulisho cha wakala' },
  scopes: {
    en: 'Scopes (comma-separated)',
    sw: 'Mawanda (yaliyotenganishwa kwa koma)',
  },
  validDays: { en: 'Valid for (days)', sw: 'Halali kwa (siku)' },
  issue: { en: 'Issue', sw: 'Toa' },
  active: { en: 'Active certifications', sw: 'Vyeti vinavyotumika' },
  emptyTitle: { en: 'No certifications yet', sw: 'Hakuna vyeti bado' },
  emptyBody: {
    en: 'Issue a certification above to grant an external integrator scoped access.',
    sw: 'Toa cheti hapo juu kuruhusu mwunganishaji wa nje ufikiaji wenye mawanda.',
  },
  scopesLabel: { en: 'Scopes', sw: 'Mawanda' },
  expires: { en: 'Expires', sw: 'Inaisha' },
  revoke: { en: 'Revoke', sw: 'Batilisha' },
  revokeTitle: { en: 'Revoke certification', sw: 'Batilisha cheti' },
  revokeExplain: {
    en: 'Provide a reason — recorded in the revocation history.',
    sw: 'Toa sababu — inarekodiwa katika historia ya ubatilishaji.',
  },
  reason: { en: 'Reason', sw: 'Sababu' },
  confirmRevoke: { en: 'Confirm revoke', sw: 'Thibitisha ubatilishaji' },
  cancel: { en: 'Cancel', sw: 'Ghairi' },
  revocationHistory: { en: 'Revocation history', sw: 'Historia ya ubatilishaji' },
  cert: { en: 'Cert', sw: 'Cheti' },
} as const;

export function IntegrationsClient({ initialLocale }: { readonly initialLocale?: Locale } = {}) {
  const locale = useLocale(initialLocale);
  const [certs, setCerts] = useState<readonly Certification[]>([]);
  const [revocations, setRevocations] = useState<readonly Revocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [revokeReason, setRevokeReason] = useState('');
  const [form, setForm] = useState({
    agentId: '',
    scopes: 'read:site,read:licence',
    days: '90',
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [list, revs] = await Promise.all([
      api.get<readonly Certification[]>('/agent-certifications'),
      api.get<readonly Revocation[]>('/agent-certifications/revocations'),
    ]);
    if (list.success && list.data) setCerts(list.data);
    else setError(list.error ?? pickByLocale(locale, S.loadFailed));
    if (revs.success && revs.data) setRevocations(revs.data);
    setLoading(false);
  }, [locale]);

  useEffect(() => {
    void load();
  }, [load]);

  async function issue(): Promise<void> {
    const scopes = form.scopes
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!form.agentId || scopes.length === 0) return;
    setIssuing(true);
    setError(null);
    const validForMs = Number(form.days) * 24 * 60 * 60 * 1000;
    const res = await api.post('/agent-certifications', {
      agentId: form.agentId,
      scopes,
      validForMs,
    });
    setIssuing(false);
    if (res.success) {
      setForm({ agentId: '', scopes: 'read:site,read:licence', days: '90' });
      void load();
    } else {
      setError(res.error ?? pickByLocale(locale, S.issueFailed));
    }
  }

  async function confirmRevoke(): Promise<void> {
    if (!revokingId || !revokeReason.trim()) return;
    setRevoking(true);
    setError(null);
    const res = await api.delete(
      `/agent-certifications/${encodeURIComponent(revokingId)}`,
      { reason: revokeReason.trim() },
    );
    setRevoking(false);
    if (res.success) {
      setRevokingId(null);
      setRevokeReason('');
      void load();
    } else {
      setError(res.error ?? pickByLocale(locale, S.revokeFailed));
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <KeyRound className="h-6 w-6 text-warning" />
        <p className="text-sm text-muted-foreground">
          {pickByLocale(locale, S.intro)}
        </p>
      </header>

      {error && <Alert variant="error">{error}</Alert>}

      <Card className="max-w-xl space-y-3 rounded-2xl p-6 transition-colors hover:border-border-strong">
        <h3 className="flex items-center gap-2 font-display text-foreground">
          <Plus className="h-4 w-4" /> {pickByLocale(locale, S.issueNew)}
        </h3>
        <FormField label={pickByLocale(locale, S.agentId)} name="agentId">
          <Input
            type="text"
            value={form.agentId}
            onChange={(e) => setForm({ ...form, agentId: e.target.value })}
          />
        </FormField>
        <FormField label={pickByLocale(locale, S.scopes)} name="scopes">
          <Input
            type="text"
            value={form.scopes}
            onChange={(e) => setForm({ ...form, scopes: e.target.value })}
          />
        </FormField>
        <FormField label={pickByLocale(locale, S.validDays)} name="days">
          <Input
            type="number"
            min="1"
            max="1095"
            value={form.days}
            onChange={(e) => setForm({ ...form, days: e.target.value })}
          />
        </FormField>
        <Button
          type="button"
          onClick={() => void issue()}
          disabled={!form.agentId}
          loading={issuing}
        >
          {pickByLocale(locale, S.issue)}
        </Button>
      </Card>

      <Card className="overflow-hidden rounded-2xl p-6 transition-colors hover:border-border-strong">
        <header className="mb-3 border-b border-border/40 pb-3">
          <h3 className="font-display text-foreground">
            {pickByLocale(locale, S.active)}
          </h3>
        </header>
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-md" />
            ))}
          </div>
        ) : certs.length === 0 ? (
          <Empty
            title={pickByLocale(locale, S.emptyTitle)}
            description={pickByLocale(locale, S.emptyBody)}
          />
        ) : (
          <ul className="divide-y divide-border/40">
            {certs.map((c) => (
              <li key={c.id} className="flex items-center justify-between py-3">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {c.agentId}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {pickByLocale(locale, S.scopesLabel)}: {c.scopes.join(', ')}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {pickByLocale(locale, S.expires)}{' '}
                    {formatDateTime(c.expiresAt, locale)}
                  </p>
                </div>
                {!c.revokedAt && (
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    onClick={() => {
                      setRevokingId(c.id);
                      setRevokeReason('');
                    }}
                    className="h-auto gap-1 p-0 text-xs text-danger"
                    leftIcon={<Trash2 className="h-3 w-3" />}
                  >
                    {pickByLocale(locale, S.revoke)}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal
        open={revokingId !== null}
        onClose={() => {
          setRevokingId(null);
          setRevokeReason('');
        }}
        title={pickByLocale(locale, S.revokeTitle)}
        description={pickByLocale(locale, S.revokeExplain)}
        size="md"
      >
        <ModalBody>
          <FormField label={pickByLocale(locale, S.reason)} name="revokeReason" required>
            <Input
              type="text"
              value={revokeReason}
              onChange={(e) => setRevokeReason(e.target.value)}
              autoFocus
            />
          </FormField>
        </ModalBody>
        <ModalFooter>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setRevokingId(null);
              setRevokeReason('');
            }}
            disabled={revoking}
          >
            {pickByLocale(locale, S.cancel)}
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => void confirmRevoke()}
            disabled={!revokeReason.trim()}
            loading={revoking}
          >
            {pickByLocale(locale, S.confirmRevoke)}
          </Button>
        </ModalFooter>
      </Modal>

      {revocations.length > 0 && (
        <Card className="rounded-2xl p-6 transition-colors hover:border-border-strong">
          <h3 className="mb-3 font-display text-foreground">
            {pickByLocale(locale, S.revocationHistory)}
          </h3>
          <ul className="divide-y divide-border/40 text-sm">
            {revocations.map((r) => (
              <li key={r.id} className="py-2">
                <p className="text-foreground">
                  {pickByLocale(locale, S.cert)}{' '}
                  <code className="text-xs">{r.certId}</code> — {r.reason}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(r.revokedAt, locale)}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
