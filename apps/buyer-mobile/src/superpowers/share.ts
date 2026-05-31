/**
 * Superpower 4 — share (buyer persona).
 *
 * Mints a real server-side share link via /api/v1/owner/share-links
 * (the canonical Wave SUPERPOWERS route, reused for the buyer persona —
 * see `SHARE_ENTITY_TYPES` enum extension in
 * packages/database/src/schemas/share-links.schema.ts). NO hardcoded
 * fallback deep-link — errors are surfaced to the caller.
 */
import { Share, type ShareContent } from 'react-native'
import * as Linking from 'expo-linking'
import { apiFetch } from '@/api/client'

export interface ShareEntityRequest {
  readonly entityType: 'offer' | 'rfb' | 'contract' | 'parcel' | 'bid'
  readonly entityId: string
  readonly title: string
}

export interface ShareResult {
  readonly ok: boolean
  readonly url?: string
  readonly cancelled?: boolean
  readonly error?: string
  readonly code?: string
}

interface ShareLinkApiResponse {
  readonly success: boolean
  readonly data?: { readonly url?: string; readonly token?: string }
  readonly error?: { readonly code?: string; readonly message?: string }
}

export async function shareEntity(req: ShareEntityRequest): Promise<ShareResult> {
  let url: string
  try {
    const res = await apiFetch<ShareLinkApiResponse>('/api/v1/owner/share-links', {
      method: 'POST',
      body: {
        entityType: req.entityType,
        entityId: req.entityId,
        permission: 'read',
        expiresInHours: 168,
        provenance: { persona: 'buyer', surface: 'buyer-mobile' }
      }
    })
    if (!res?.success || !res.data?.url) {
      return {
        ok: false,
        error: res?.error?.message ?? 'Share link API returned no URL',
        code: res?.error?.code ?? 'SHARE_LINK_EMPTY'
      }
    }
    url = res.data.url
  } catch (cause) {
    return {
      ok: false,
      error: cause instanceof Error ? cause.message : 'Share link request failed',
      code: 'SHARE_LINK_NETWORK'
    }
  }
  try {
    const content: ShareContent = { message: `${req.title}\n${url}`, url, title: req.title }
    const result = await Share.share(content)
    if (result.action === Share.dismissedAction) {
      return { ok: true, cancelled: true, url }
    }
    return { ok: true, url }
  } catch {
    try {
      await Linking.openURL(url)
      return { ok: true, url }
    } catch (cause) {
      return {
        ok: false,
        url,
        error: cause instanceof Error ? cause.message : 'share failed',
        code: 'SHARE_SHEET_FAILED'
      }
    }
  }
}
