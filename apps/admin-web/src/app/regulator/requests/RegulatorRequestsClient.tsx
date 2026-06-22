'use client';

/**
 * Regulator requests admin inbox — closes chain C-A (issue #194).
 *
 *   GET  /api/v1/regulator/requests            — list
 *   POST /api/v1/regulator/requests            — create
 *   POST /api/v1/regulator/requests/:id/parse  — flip to owner_review
 *   POST /api/v1/regulator/requests/:id/export-redacted
 *   POST /api/v1/regulator/requests/:id/deliver
 *   POST /api/v1/regulator/requests/:id/reject
 *
 * Rendered on DESIGN-SYSTEM primitives + semantic TOKENS so the screen
 * lives correctly inside the dark admin shell (the previous build was a
 * full light-theme leaf — bg-white / slate-* / amber-100 — that read as
 * broken). SINGLE LANGUAGE PER LOCALE (canon): every user-facing string
 * resolves to the active locale via `pickByLocale`, seeded from the
 * server-resolved cookie (`initialLocale`) so SSR + the first client paint
 * agree. Agency acronyms (PCCB / NEMC / EITI / TMAA) are proper nouns and
 * are kept verbatim. Both summary values are retained in CreatePayload so
 * the downstream bilingual record stays complete.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Badge,
  Alert,
  Modal,
  ModalFooter,
  Input,
  Textarea,
  type BadgeProps,
} from '@borjie/design-system';
import { api } from '@/lib/api';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';

type Regulator = 'pccb' | 'nemc' | 'eiti' | 'tmaa' | 'other';
type SubjectKind =
  | 'worker'
  | 'site'
  | 'licence'
  | 'tenant'
  | 'company'
  | 'shipment';
type Status =
  | 'received'
  | 'parsed'
  | 'owner_review'
  | 'disclosure_approved'
  | 'exporting'
  | 'exported'
  | 'delivered'
  | 'rejected'
  | 'expired';

interface RegulatorRequestRow {
  readonly id: string;
  readonly regulator: Regulator;
  readonly regulatorRef: string | null;
  readonly subjectKind: SubjectKind;
  readonly subjectRef: string;
  readonly status: Status;
  readonly summarySw: string | null;
  readonly summaryEn: string | null;
  readonly requestedAt: string;
  readonly dueAt: string;
  readonly responseDocUrl: string | null;
}

interface CreatePayload {
  readonly regulator: Regulator;
  readonly subjectKind: SubjectKind;
  readonly subjectRef: string;
  readonly summarySw?: string;
  readonly summaryEn?: string;
}

/** Status → DS badge tone, on semantic tokens (no raw light palette). */
const STATUS_TONE: Readonly<Record<Status, BadgeProps['variant']>> =
  Object.freeze({
    received: 'secondary',
    parsed: 'secondary',
    owner_review: 'warning-soft',
    disclosure_approved: 'success-soft',
    exporting: 'info-soft',
    exported: 'info-soft',
    delivered: 'success',
    rejected: 'error-soft',
    expired: 'outline',
  });

/** Agency proper nouns — kept verbatim across locales. */
const REGULATOR_LABEL: Readonly<Record<Regulator, string>> = Object.freeze({
  pccb: 'PCCB / PDPC',
  nemc: 'NEMC',
  eiti: 'EITI / TEITI',
  tmaa: 'TMAA',
  other: 'Other',
});

function statusLabel(status: Status, locale: Locale): string {
  const map: Record<Status, { en: string; sw: string }> = {
    received: { en: 'received', sw: 'imepokelewa' },
    parsed: { en: 'parsed', sw: 'imechanganuliwa' },
    owner_review: { en: 'owner review', sw: 'ukaguzi wa mmiliki' },
    disclosure_approved: { en: 'disclosure approved', sw: 'ufichuzi umeidhinishwa' },
    exporting: { en: 'exporting', sw: 'inasafirisha' },
    exported: { en: 'exported', sw: 'imesafirishwa' },
    delivered: { en: 'delivered', sw: 'imewasilishwa' },
    rejected: { en: 'rejected', sw: 'imekataliwa' },
    expired: { en: 'expired', sw: 'imeisha muda' },
  };
  return pickByLocale(locale, map[status]);
}

function subjectKindLabel(kind: SubjectKind, locale: Locale): string {
  const map: Record<SubjectKind, { en: string; sw: string }> = {
    worker: { en: 'Worker', sw: 'Mfanyakazi' },
    site: { en: 'Site', sw: 'Eneo' },
    licence: { en: 'Licence', sw: 'Leseni' },
    tenant: { en: 'Tenant', sw: 'Mteja' },
    company: { en: 'Company', sw: 'Kampuni' },
    shipment: { en: 'Shipment', sw: 'Mzigo' },
  };
  return pickByLocale(locale, map[kind]);
}

function daysUntilLabel(dueAt: string, locale: Locale): string {
  const ms = new Date(dueAt).getTime() - Date.now();
  const days = Math.ceil(ms / (24 * 60 * 60 * 1000));
  if (days < 0)
    return pickByLocale(locale, {
      en: `${Math.abs(days)}d overdue`,
      sw: `siku ${Math.abs(days)} zimepita`,
    });
  if (days === 0)
    return pickByLocale(locale, { en: 'Due today', sw: 'Inastahili leo' });
  return pickByLocale(locale, {
    en: `${days}d remaining`,
    sw: `siku ${days} zimebaki`,
  });
}

const REGULATOR_OPTIONS: ReadonlyArray<Regulator> = [
  'pccb',
  'nemc',
  'eiti',
  'tmaa',
  'other',
];
const SUBJECT_KIND_OPTIONS: ReadonlyArray<SubjectKind> = [
  'worker',
  'site',
  'licence',
  'tenant',
  'company',
  'shipment',
];

export function RegulatorRequestsClient({
  initialLocale,
}: {
  readonly initialLocale?: Locale;
} = {}) {
  // Seed from the server-resolved cookie to avoid the first-paint split-brain.
  const locale = useLocale(initialLocale);
  const [rows, setRows] = useState<readonly RegulatorRequestRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [draft, setDraft] = useState<CreatePayload>({
    regulator: 'pccb',
    subjectKind: 'worker',
    subjectRef: '',
  });
  // Reject flow: DS Modal + DS Input replaces the native window.prompt().
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await api.get<readonly RegulatorRequestRow[]>(
      '/regulator/requests',
    );
    setLoading(false);
    if (res.success && res.data) {
      setRows(res.data);
    } else {
      setError(
        res.error ??
          pickByLocale(locale, {
            en: 'Failed to load regulator requests',
            sw: 'Imeshindwa kupakia maombi ya wadhibiti',
          }),
      );
    }
  }, [locale]);

  useEffect(() => {
    void load();
  }, [load]);

  const submitNew = useCallback(async () => {
    if (!draft.subjectRef) {
      setError(
        pickByLocale(locale, {
          en: 'Subject reference is required',
          sw: 'Kumbukumbu ya mhusika inahitajika',
        }),
      );
      return;
    }
    setLoading(true);
    setError(null);
    setMessage(null);
    const res = await api.post<RegulatorRequestRow>(
      '/regulator/requests',
      draft,
    );
    setLoading(false);
    if (res.success && res.data) {
      setMessage(
        pickByLocale(locale, {
          en: `Captured ${res.data.id} — ${statusLabel(res.data.status, 'en')}`,
          sw: `Imehifadhiwa ${res.data.id} — ${statusLabel(res.data.status, 'sw')}`,
        }),
      );
      setDraft({ ...draft, subjectRef: '' });
      await load();
    } else {
      setError(
        res.error ??
          pickByLocale(locale, {
            en: 'Failed to capture request',
            sw: 'Imeshindwa kuhifadhi ombi',
          }),
      );
    }
  }, [draft, load, locale]);

  const advance = useCallback(
    async (id: string, path: 'parse' | 'export-redacted' | 'deliver') => {
      setLoading(true);
      setError(null);
      const res = await api.post<unknown>(`/regulator/requests/${id}/${path}`, {});
      setLoading(false);
      if (res.success) {
        setMessage(
          pickByLocale(locale, {
            en: `${id}: ${path} ok`,
            sw: `${id}: ${path} imefaulu`,
          }),
        );
        await load();
      } else {
        setError(
          res.error ??
            pickByLocale(locale, {
              en: `Failed to ${path} ${id}`,
              sw: `Imeshindwa kutekeleza ${path} kwa ${id}`,
            }),
        );
      }
    },
    [load, locale],
  );

  const confirmReject = useCallback(async () => {
    const id = rejectTarget;
    const reason = rejectReason.trim();
    if (!id || !reason) return;
    setLoading(true);
    setError(null);
    const res = await api.post<unknown>(`/regulator/requests/${id}/reject`, {
      reason,
    });
    setLoading(false);
    setRejectTarget(null);
    setRejectReason('');
    if (res.success) {
      setMessage(
        pickByLocale(locale, {
          en: `${id}: rejected`,
          sw: `${id}: imekataliwa`,
        }),
      );
      await load();
    } else {
      setError(
        res.error ??
          pickByLocale(locale, {
            en: `Failed to reject ${id}`,
            sw: `Imeshindwa kukataa ${id}`,
          }),
      );
    }
  }, [rejectTarget, rejectReason, load, locale]);

  const totals = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
    return counts;
  }, [rows]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>
            {pickByLocale(locale, {
              en: 'Capture inbound request',
              sw: 'Hifadhi ombi linaloingia',
            })}
          </CardTitle>
          <CardDescription>
            {pickByLocale(locale, {
              en: 'Paste the regulator’s ask. Status starts at “received” and auto-advances to “owner review” on parse.',
              sw: 'Bandika ombi la mdhibiti. Hali huanza kwa “imepokelewa” na husonga mbele kiotomatiki hadi “ukaguzi wa mmiliki” baada ya kuchanganua.',
            })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <label className="block text-sm text-foreground">
              <span className="mb-1 block text-muted-foreground">
                {pickByLocale(locale, { en: 'Regulator', sw: 'Mdhibiti' })}
              </span>
              <select
                value={draft.regulator}
                onChange={(e) =>
                  setDraft({ ...draft, regulator: e.target.value as Regulator })
                }
                aria-label={pickByLocale(locale, {
                  en: 'Regulator',
                  sw: 'Mdhibiti',
                })}
                className="h-10 w-full rounded-md border border-border bg-surface-sunken px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {REGULATOR_OPTIONS.map((value) => (
                  <option key={value} value={value}>
                    {REGULATOR_LABEL[value]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm text-foreground">
              <span className="mb-1 block text-muted-foreground">
                {pickByLocale(locale, {
                  en: 'Subject kind',
                  sw: 'Aina ya mhusika',
                })}
              </span>
              <select
                value={draft.subjectKind}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    subjectKind: e.target.value as SubjectKind,
                  })
                }
                aria-label={pickByLocale(locale, {
                  en: 'Subject kind',
                  sw: 'Aina ya mhusika',
                })}
                className="h-10 w-full rounded-md border border-border bg-surface-sunken px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {SUBJECT_KIND_OPTIONS.map((value) => (
                  <option key={value} value={value}>
                    {subjectKindLabel(value, locale)}
                  </option>
                ))}
              </select>
            </label>
            <Input
              label={pickByLocale(locale, {
                en: 'Subject reference',
                sw: 'Kumbukumbu ya mhusika',
              })}
              value={draft.subjectRef}
              onChange={(e) =>
                setDraft({ ...draft, subjectRef: e.target.value })
              }
              placeholder="usr-… / site-… / lic-…"
            />
          </div>

          {locale === 'sw' ? (
            <Textarea
              label="Muhtasari"
              value={draft.summarySw ?? ''}
              onChange={(e) =>
                setDraft({ ...draft, summarySw: e.target.value })
              }
              rows={2}
              placeholder="Maandishi ya muhtasari kwa Kiswahili"
            />
          ) : (
            <Textarea
              label="Summary"
              value={draft.summaryEn ?? ''}
              onChange={(e) =>
                setDraft({ ...draft, summaryEn: e.target.value })
              }
              rows={2}
              placeholder="English summary text"
            />
          )}

          <div className="flex justify-end">
            <Button
              loading={loading}
              disabled={loading}
              onClick={() => void submitNew()}
            >
              {loading
                ? pickByLocale(locale, { en: 'Saving…', sw: 'Inahifadhi…' })
                : pickByLocale(locale, {
                    en: 'Capture request',
                    sw: 'Hifadhi ombi',
                  })}
            </Button>
          </div>
        </CardContent>
      </Card>

      {error && (
        <Alert variant="error" hideIcon={false}>
          {error}
        </Alert>
      )}
      {message && (
        <Alert variant="success" hideIcon={false}>
          {message}
        </Alert>
      )}

      <section className="space-y-3">
        <header className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold text-foreground">
            {pickByLocale(locale, {
              en: `Inbox (${rows.length})`,
              sw: `Kikasha (${rows.length})`,
            })}
          </h2>
          <ul className="flex flex-wrap gap-2">
            {Object.entries(totals).map(([k, v]) => (
              <li key={k}>
                <Badge
                  variant={STATUS_TONE[k as Status] ?? 'secondary'}
                  size="sm"
                >
                  {statusLabel(k as Status, locale)}: {v}
                </Badge>
              </li>
            ))}
          </ul>
        </header>

        <Card variant="outline" padding="none" className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  {pickByLocale(locale, { en: 'Regulator', sw: 'Mdhibiti' })}
                </TableHead>
                <TableHead>
                  {pickByLocale(locale, { en: 'Subject', sw: 'Mhusika' })}
                </TableHead>
                <TableHead>
                  {pickByLocale(locale, { en: 'Status', sw: 'Hali' })}
                </TableHead>
                <TableHead>
                  {pickByLocale(locale, { en: 'SLA', sw: 'SLA' })}
                </TableHead>
                <TableHead className="text-right">
                  {pickByLocale(locale, { en: 'Actions', sw: 'Vitendo' })}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="py-8 text-center text-muted-foreground"
                  >
                    {pickByLocale(locale, {
                      en: 'No regulator requests yet.',
                      sw: 'Hakuna maombi ya wadhibiti bado.',
                    })}
                  </TableCell>
                </TableRow>
              )}
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium uppercase text-foreground">
                    {REGULATOR_LABEL[row.regulator]}
                  </TableCell>
                  <TableCell className="text-foreground">
                    <div>{subjectKindLabel(row.subjectKind, locale)}</div>
                    <div className="text-xs text-muted-foreground">
                      {row.subjectRef}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={STATUS_TONE[row.status] ?? 'secondary'}
                      size="sm"
                    >
                      {statusLabel(row.status, locale)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {daysUntilLabel(row.dueAt, locale)}
                  </TableCell>
                  <TableCell className="space-x-1 text-right">
                    {row.status === 'received' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void advance(row.id, 'parse')}
                      >
                        {pickByLocale(locale, { en: 'Parse', sw: 'Changanua' })}
                      </Button>
                    )}
                    {row.status === 'disclosure_approved' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void advance(row.id, 'export-redacted')}
                      >
                        {pickByLocale(locale, {
                          en: 'Export',
                          sw: 'Safirisha',
                        })}
                      </Button>
                    )}
                    {row.status === 'exported' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void advance(row.id, 'deliver')}
                      >
                        {pickByLocale(locale, {
                          en: 'Deliver',
                          sw: 'Wasilisha',
                        })}
                      </Button>
                    )}
                    {row.responseDocUrl && (
                      <Button
                        size="sm"
                        variant="ghost"
                        asChild
                      >
                        <a
                          href={row.responseDocUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {pickByLocale(locale, {
                            en: 'Download',
                            sw: 'Pakua',
                          })}
                        </a>
                      </Button>
                    )}
                    {row.status !== 'delivered' &&
                      row.status !== 'rejected' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-danger hover:text-danger"
                          onClick={() => {
                            setRejectReason('');
                            setRejectTarget(row.id);
                          }}
                        >
                          {pickByLocale(locale, { en: 'Reject', sw: 'Kataa' })}
                        </Button>
                      )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </section>

      <Modal
        open={rejectTarget !== null}
        onClose={() => {
          setRejectTarget(null);
          setRejectReason('');
        }}
        title={pickByLocale(locale, {
          en: 'Reject request',
          sw: 'Kataa ombi',
        })}
        description={pickByLocale(locale, {
          en: 'Record a reason for rejecting this regulator request. It is stored on the audit trail.',
          sw: 'Andika sababu ya kukataa ombi hili la mdhibiti. Huhifadhiwa kwenye njia ya ukaguzi.',
        })}
        size="md"
      >
        <Textarea
          label={pickByLocale(locale, {
            en: 'Reason for rejection',
            sw: 'Sababu ya kukataa',
          })}
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
          rows={3}
          autoFocus
          placeholder={pickByLocale(locale, {
            en: 'Why is this request being rejected?',
            sw: 'Kwa nini ombi hili linakataliwa?',
          })}
        />
        <ModalFooter
          primaryLabel={pickByLocale(locale, {
            en: 'Reject',
            sw: 'Kataa',
          })}
          secondaryLabel={pickByLocale(locale, {
            en: 'Cancel',
            sw: 'Ghairi',
          })}
          primaryVariant="danger"
          primaryLoading={loading}
          primaryDisabled={loading || rejectReason.trim() === ''}
          onPrimaryAction={() => void confirmReject()}
          onSecondaryAction={() => {
            setRejectTarget(null);
            setRejectReason('');
          }}
        />
      </Modal>
    </div>
  );
}
