/**
 * Download a WhatsApp voice media file using the Cloud API.
 *
 * Two-step: GET /<mediaId> → returns a signed `url`; then GET that url
 * with the access token to pull the bytes. We surface both steps so the
 * caller can inject its own `fetch` (useful for tests + retry policies).
 */

import { AudioLogicsLitfinError } from '../types.js';

export interface DownloadAudioArgs {
  readonly mediaId: string;
  readonly accessToken: string;
  readonly fetchImpl?: typeof fetch;
  readonly graphBaseUrl?: string;
}

export interface DownloadedAudio {
  readonly audio: Uint8Array;
  readonly mimeType: string;
}

/**
 * Resolve a Meta media id to its signed download url, then fetch the bytes.
 *
 * @throws AudioLogicsLitfinError on network or auth failures.
 */
export async function downloadAudio(args: DownloadAudioArgs): Promise<DownloadedAudio> {
  if (!args.mediaId) {
    throw new AudioLogicsLitfinError('mediaId required', 'whatsapp-missing-media-id');
  }
  if (!args.accessToken) {
    throw new AudioLogicsLitfinError('accessToken required', 'whatsapp-missing-access-token');
  }

  const fetchImpl = args.fetchImpl ?? fetch;
  const base = (args.graphBaseUrl ?? 'https://graph.facebook.com/v18.0').replace(/\/$/, '');

  let metaResp: Response;
  try {
    metaResp = await fetchImpl(`${base}/${args.mediaId}`, {
      headers: { Authorization: `Bearer ${args.accessToken}` },
    });
  } catch (cause) {
    throw new AudioLogicsLitfinError('failed to fetch media metadata', 'whatsapp-meta-fetch', cause);
  }
  if (!metaResp.ok) {
    throw new AudioLogicsLitfinError(
      `media metadata fetch failed: ${metaResp.status}`,
      'whatsapp-meta-fetch-bad-status',
    );
  }
  const metaJson = (await metaResp.json()) as { url?: string; mime_type?: string };
  if (!metaJson.url) {
    throw new AudioLogicsLitfinError(
      'media metadata missing url field',
      'whatsapp-meta-no-url',
    );
  }

  let mediaResp: Response;
  try {
    mediaResp = await fetchImpl(metaJson.url, {
      headers: { Authorization: `Bearer ${args.accessToken}` },
    });
  } catch (cause) {
    throw new AudioLogicsLitfinError('failed to fetch media bytes', 'whatsapp-media-fetch', cause);
  }
  if (!mediaResp.ok) {
    throw new AudioLogicsLitfinError(
      `media bytes fetch failed: ${mediaResp.status}`,
      'whatsapp-media-fetch-bad-status',
    );
  }

  const buf = new Uint8Array(await mediaResp.arrayBuffer());
  return {
    audio: buf,
    mimeType: metaJson.mime_type ?? 'audio/ogg',
  };
}
