/**
 * Thin HTTP client for the WhatsApp Business Cloud Graph API.
 *
 * Every call goes through an injected `Fetcher` port so live-test
 * discipline holds. Production wires `globalThis.fetch`.
 *
 * Reference: Meta — "Cloud API Reference"
 *   https://developers.facebook.com/docs/whatsapp/cloud-api/reference
 *   (visited 2026-05-26).
 */

import type { Fetcher } from '../types.js';

const GRAPH_BASE = 'https://graph.facebook.com/v20.0';

export interface WhatsappHttpClient {
  readonly getMedia: (
    mediaId: string,
    accessToken: string,
  ) => Promise<WhatsappMediaResponse>;
  readonly downloadMediaBytes: (
    mediaUrl: string,
    accessToken: string,
  ) => Promise<ArrayBuffer>;
}

export interface WhatsappMediaResponse {
  readonly id: string;
  readonly url: string;
  readonly mime_type: string;
  readonly sha256: string;
  readonly file_size: number;
  readonly messaging_product: 'whatsapp';
}

export interface WhatsappHttpDeps {
  readonly fetcher: Fetcher;
  readonly baseUrl?: string;
}

export function createWhatsappHttpClient(
  deps: WhatsappHttpDeps,
): WhatsappHttpClient {
  const base = deps.baseUrl ?? GRAPH_BASE;
  return {
    async getMedia(mediaId, accessToken) {
      const req = new Request(`${base}/${encodeURIComponent(mediaId)}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const res = await deps.fetcher(req);
      if (!res.ok) {
        throw new Error(`WhatsApp getMedia failed: ${res.status}`);
      }
      const json = (await res.json()) as WhatsappMediaResponse;
      return json;
    },
    async downloadMediaBytes(mediaUrl, accessToken) {
      const req = new Request(mediaUrl, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const res = await deps.fetcher(req);
      if (!res.ok) {
        throw new Error(`WhatsApp downloadMediaBytes failed: ${res.status}`);
      }
      return await res.arrayBuffer();
    },
  };
}
