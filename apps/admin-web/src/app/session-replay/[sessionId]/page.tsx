/**
 * Session replay viewer page — Central Command Phase B (B5).
 *
 * Admin-gated (SUPER_ADMIN + ADMIN) by the staff layout. Receives a
 * `sessionId` URL param and hands it to the `SessionReplayViewer`
 * client component which fetches chunk metadata, downloads the gzipped
 * payloads from the api-gateway, and renders an rrweb-player.
 *
 * The replay events stream is held SEPARATELY from the sensorium
 * 14-event taxonomy. Mouse-move at ≈20Hz lives here; it is NEVER fed
 * into the LLM context.
 */

import { PageShell } from '@/components/migrated/PageShell';
import { SessionReplayViewer } from '@/components/SessionReplayViewer';
import { readLocaleFromServerCookies } from '@/lib/locale.server';
import { pickByLocale } from '@/lib/locale-shared';

interface SessionReplayPageProps {
  readonly params: Promise<{ sessionId: string }>;
}

export default async function SessionReplayPage({
  params,
}: SessionReplayPageProps) {
  const { sessionId } = await params;
  const locale = await readLocaleFromServerCookies();
  return (
    <PageShell
      title={pickByLocale(locale, {
        en: 'Session replay',
        sw: 'Uchezaji wa kipindi',
      })}
      subtitle={pickByLocale(locale, {
        en:
          `Cold-store playback of session ${sessionId}. rrweb event ` +
          'stream is PII-masked at capture; the brain never sees these ' +
          'bytes.',
        sw:
          `Uchezaji wa kipindi ${sessionId} kutoka hifadhi baridi. Mkondo ` +
          'wa matukio ya rrweb hufichwa PII wakati wa kunasa; ubongo ' +
          'hauoni baiti hizi kamwe.',
      })}
    >
      <SessionReplayViewer sessionId={sessionId} initialLocale={locale} />
    </PageShell>
  );
}
