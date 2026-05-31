/**
 * Superpower 4 — share (workforce persona).
 *
 * Mints a real server-side share link via /api/v1/owner/share-links,
 * then opens the native share-sheet with the URL. NO hardcoded fallback
 * deep-link — if the backend fails the caller learns about it and can
 * surface a useful error in the UI.
 *
 * Server route: services/api-gateway/src/routes/owner/share-links.hono.ts
 */
import { Share, type ShareContent } from 'react-native'
import * as Linking from 'expo-linking'
import { ownerApi } from '../api/client'

/**
 * Entity types the workforce app can surface to the share API.
 * Mapped 1:1 to the SHARE_ENTITY_TYPES enum in
 * packages/database/src/schemas/share-links.schema.ts.
 */
export type WorkforceShareEntityType =
  | 'draft'
  | 'document'
  | 'royalty_filing'
  | 'production_report'
  | 'compliance_artifact'
  | 'reminder'
  | 'shipment'
  | 'invoice'

export interface ShareEntityRequest {
  readonly entityType: WorkforceShareEntityType
  readonly entityId: string
  readonly title: string
  readonly persona?: 'worker' | 'manager' | 'owner'
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

/**
 * Mint a server-side share link, then open the native share-sheet with
 * the URL + entity title. If the backend rejects or is unreachable, the
 * promise resolves with `ok: false` carrying the underlying error so the
 * UI can surface it (no silent fake links).
 */
export async function shareEntity(req: ShareEntityRequest): Promise<ShareResult> {
  let url: string
  try {
    const res = await ownerApi.post<ShareLinkApiResponse>('/share-links', {
      entityType: req.entityType,
      entityId: req.entityId,
      permission: 'read',
      expiresInHours: 168,
      provenance: { persona: req.persona ?? 'worker', surface: 'workforce-mobile' }
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
      return {
        ok: false,
        url,
        error: cause instanceof Error ? cause.message : 'share failed',
        code: 'SHARE_SHEET_FAILED'
      }
    }
  }
}
