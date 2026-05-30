/**
 * Superpower 4 — share.
 *
 * Uses RN's built-in `Share` (which surfaces the native iOS share-sheet
 * / Android Intent.ACTION_SEND) so we do not pull in `expo-sharing` as
 * a new dep. Falls back to `expo-linking.openURL` if the share sheet
 * is unavailable (web preview, headless test runs).
 */
import { Share, type ShareContent } from 'react-native'
import * as Linking from 'expo-linking'
import { miningApi } from '../api/client'

export interface ShareEntityRequest {
  readonly entityType: string
  readonly entityId: string
  readonly title: string
  readonly persona?: 'worker' | 'manager' | 'owner'
}

export interface ShareResult {
  readonly ok: boolean
  readonly url?: string
  readonly cancelled?: boolean
  readonly error?: string
}

interface ShareLinkApiResponse {
  readonly success: boolean
  readonly data?: { readonly url: string }
}

const FALLBACK_HOST = 'https://borjie.app'

function buildFallbackLink(req: ShareEntityRequest): string {
  return `${FALLBACK_HOST}/${encodeURIComponent(req.entityType)}/${encodeURIComponent(req.entityId)}`
}

/**
 * Mint a server-side share link, then open the native share-sheet
 * with the URL + entity title. Persona is forwarded so the server can
 * scope permission (workforce-mobile defaults to "worker" → read-only).
 */
export async function shareEntity(req: ShareEntityRequest): Promise<ShareResult> {
  let url = buildFallbackLink(req)
  try {
    const res = await miningApi.post<ShareLinkApiResponse>('/superpowers/share-links', {
      entityType: req.entityType,
      entityId: req.entityId,
      persona: req.persona ?? 'worker',
      permission: 'read',
      expiresInHours: 168
    })
    if (res?.success && res.data?.url) {
      url = res.data.url
    }
  } catch {
    // network error → still share the deep-link fallback
  }
  try {
    const content: ShareContent = {
      message: `${req.title}\n${url}`,
      url,
      title: req.title
    }
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
      return { ok: false, url, error: cause instanceof Error ? cause.message : 'share failed' }
    }
  }
}
