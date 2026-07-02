'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getCsrfHeaders } from '@/lib/csrf';
import { requirePublicBaseUrl } from '@/lib/env-guard';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';
import { Button } from '@borjie/design-system';

/**
 * Local bilingual copy. Kept inline (single language rendered per active
 * locale via `pickByLocale`) so this new surface does not fork a shared
 * i18n string bundle while other work touches the same files. Every entry
 * carries BOTH `en` and `sw` — zero cross-language fallback.
 */
const T = {
  eyebrow: { en: 'FOUR-EYE APPROVAL', sw: 'IDHINI YA MACHO-MAWILI' },
  header: {
    en: 'Approve a high-risk action',
    sw: 'Idhinisha kitendo cha hatari kubwa',
  },
  missingId: {
    en: 'This approval link is missing its action id.',
    sw: 'Kiungo hiki cha idhini hakina kitambulisho cha kitendo.',
  },
  body: {
    en: 'An external agent requested a sovereign action that requires your explicit approval before it runs.',
    sw: 'Wakala wa nje ameomba kitendo cha ngazi ya juu kinachohitaji idhini yako kabla ya kutekelezwa.',
  },
  idLabel: { en: 'Action id', sw: 'Kitambulisho cha kitendo' },
  approve: { en: 'Approve', sw: 'Idhinisha' },
  deny: { en: 'Deny', sw: 'Kataa' },
  approvedTitle: { en: 'Action approved', sw: 'Kitendo kimeidhinishwa' },
  approvedBody: {
    en: 'The agent can now execute this action once.',
    sw: 'Wakala sasa anaweza kutekeleza kitendo hiki mara moja.',
  },
  deniedTitle: { en: 'Action denied', sw: 'Kitendo kimekataliwa' },
  deniedBody: {
    en: 'This action is locked and cannot run.',
    sw: 'Kitendo hiki kimefungwa na hakiwezi kutekelezwa.',
  },
  expired: {
    en: 'This approval has expired. Ask the agent to request it again.',
    sw: 'Idhini hii imekwisha muda. Mwombe wakala aiombe tena.',
  },
  forbidden: {
    en: 'You are not authorized to approve this action.',
    sw: 'Hauna ruhusa ya kuidhinisha kitendo hiki.',
  },
  problem: {
    en: 'We could not complete that request. Please try again.',
    sw: 'Hatukuweza kukamilisha ombi hilo. Tafadhali jaribu tena.',
  },
} as const;

function gatewayBaseUrl(): string {
  return requirePublicBaseUrl(
    'NEXT_PUBLIC_API_GATEWAY_URL',
    'http://localhost:4001',
  ).replace(/\/$/, '');
}

type Phase =
  | { kind: 'missing-id' }
  | { kind: 'ready' }
  | { kind: 'busy' }
  | { kind: 'approved' }
  | { kind: 'denied' }
  | { kind: 'error'; message: string };

export function ActionApprovePanel({
  initialLocale,
}: {
  readonly initialLocale?: Locale;
} = {}) {
  const router = useRouter();
  const params = useSearchParams();
  const locale = useLocale(initialLocale);
  const approvalId = params.get('id') ?? '';

  const [phase, setPhase] = useState<Phase>(
    approvalId.length > 0 ? { kind: 'ready' } : { kind: 'missing-id' },
  );

  async function submit(decision: 'approve' | 'deny') {
    if (approvalId.length === 0) return;
    setPhase({ kind: 'busy' });
    try {
      const res = await fetch(`${gatewayBaseUrl()}/mcp/actions/${decision}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getCsrfHeaders() },
        credentials: 'include',
        body: JSON.stringify({ approvalId }),
      });
      if (res.status === 401) {
        router.push(
          `/sign-in?next=${encodeURIComponent(
            `/oauth/actions/approve?id=${approvalId}`,
          )}`,
        );
        return;
      }
      if (res.status === 403) {
        setPhase({ kind: 'error', message: pickByLocale(locale, T.forbidden) });
        return;
      }
      if (res.status === 410) {
        setPhase({ kind: 'error', message: pickByLocale(locale, T.expired) });
        return;
      }
      if (!res.ok) {
        setPhase({ kind: 'error', message: pickByLocale(locale, T.problem) });
        return;
      }
      setPhase({ kind: decision === 'approve' ? 'approved' : 'denied' });
    } catch {
      setPhase({ kind: 'error', message: pickByLocale(locale, T.problem) });
    }
  }

  return (
    <div className="w-full max-w-xl rounded-lg border border-border bg-surface p-8">
      <header className="mb-6">
        <div className="text-xs font-mono text-neutral-500">
          {pickByLocale(locale, T.eyebrow)}
        </div>
        <h1 className="mt-1 font-display text-2xl text-foreground">
          {pickByLocale(locale, T.header)}
        </h1>
      </header>

      {phase.kind === 'missing-id' && (
        <p className="text-sm text-destructive">
          {pickByLocale(locale, T.missingId)}
        </p>
      )}

      {phase.kind === 'error' && (
        <div className="rounded border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {phase.message}
        </div>
      )}

      {(phase.kind === 'ready' || phase.kind === 'busy') && (
        <div className="space-y-5">
          <p className="text-sm text-foreground">{pickByLocale(locale, T.body)}</p>
          <section className="rounded border border-border bg-background p-4">
            <div className="text-xs text-neutral-500">
              {pickByLocale(locale, T.idLabel)}
            </div>
            <div className="mt-0.5 font-mono text-sm text-foreground">
              {approvalId}
            </div>
          </section>
          <div className="flex gap-3">
            <Button
              type="button"
              onClick={() => submit('approve')}
              disabled={phase.kind === 'busy'}
              className="flex-1"
            >
              {pickByLocale(locale, T.approve)}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => submit('deny')}
              disabled={phase.kind === 'busy'}
              className="flex-1"
            >
              {pickByLocale(locale, T.deny)}
            </Button>
          </div>
        </div>
      )}

      {phase.kind === 'approved' && (
        <div className="rounded border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm">
          <p className="text-foreground">{pickByLocale(locale, T.approvedTitle)}</p>
          <p className="mt-1 italic text-neutral-400">
            {pickByLocale(locale, T.approvedBody)}
          </p>
        </div>
      )}

      {phase.kind === 'denied' && (
        <div className="rounded border border-border bg-background p-4 text-sm">
          <p className="text-foreground">{pickByLocale(locale, T.deniedTitle)}</p>
          <p className="mt-1 italic text-neutral-400">
            {pickByLocale(locale, T.deniedBody)}
          </p>
        </div>
      )}
    </div>
  );
}
