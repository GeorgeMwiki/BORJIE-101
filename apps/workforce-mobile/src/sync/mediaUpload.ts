/**
 * Media-upload step for the offline sync queue.
 *
 * Queued entities (e.g. shift reports) capture local `file://` photo and
 * voice-note URIs while offline. Those binaries cannot travel inside the
 * JSON body of the entity POST — the device path is meaningless to the
 * gateway. This helper turns a local `file://` URI into a server-side
 * document reference by:
 *
 *   1. POST /api/v1/mining/documents/upload  → metadata row + presigned PUT
 *   2. PUT  <presignedPut> <binary bytes>    → stores the blob
 *
 * It returns the canonical `fileUrl` the gateway persisted for the upload,
 * which is what the entity POST should reference in place of the local URI.
 *
 * Failures THROW (ApiError) so the flush loop keeps the entity queued and
 * retries later — we never silently drop a worker's evidence.
 */

import { miningApi } from '../api/client'
import { ApiError } from '../api/errors'

interface UploadEnvelope {
  readonly success: boolean
  readonly data: {
    readonly document: { readonly id: string; readonly fileUrl: string }
    readonly presignedPut: string
  }
}

function fileNameFromUri(uri: string, fallbackExt: string): string {
  const tail = uri.split('/').pop() ?? ''
  if (tail.length > 0 && tail.includes('.')) {
    return tail
  }
  return `${tail || `media-${Date.now()}`}.${fallbackExt}`
}

function extFromMime(mimeType: string): string {
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return 'jpg'
  if (mimeType.includes('png')) return 'png'
  if (mimeType.includes('mp4')) return 'mp4'
  if (mimeType.includes('m4a') || mimeType.includes('mp4a')) return 'm4a'
  if (mimeType.includes('wav')) return 'wav'
  return 'bin'
}

/**
 * Read a local `file://` URI into bytes via `fetch`. RN's fetch resolves
 * `file://` to the on-device blob. Throws ApiError(0) on any read failure
 * so the caller treats it as retryable.
 */
async function readLocalBytes(uri: string): Promise<ArrayBuffer> {
  try {
    const res = await fetch(uri)
    return await res.arrayBuffer()
  } catch (cause) {
    throw new ApiError(
      cause instanceof Error ? cause.message : 'Failed to read local media',
      0,
      uri,
      null
    )
  }
}

/**
 * Upload a single local media file and return the stored document ref.
 *
 * @param uri      local `file://` URI captured on-device
 * @param mimeType e.g. `image/jpeg`, `audio/m4a`
 * @param tags     descriptive tags persisted on the document row
 */
export async function uploadLocalMedia(
  uri: string,
  mimeType: string,
  tags: ReadonlyArray<string>
): Promise<string> {
  const bytes = await readLocalBytes(uri)
  const fileName = fileNameFromUri(uri, extFromMime(mimeType))

  const meta = await miningApi.post<UploadEnvelope>('/documents/upload', {
    fileName,
    fileSize: bytes.byteLength,
    mimeType,
    documentType: 'other',
    entityType: 'shift_report_media',
    tags: [...tags]
  })
  if (!meta.success || !meta.data) {
    throw new ApiError('Document metadata upload failed', 502, '/documents/upload', null)
  }

  const target = meta.data.presignedPut
  // Only an HTTP(S) presigned target is directly uploadable from the
  // device. If storage handed back an opaque URI (e.g. s3://) we cannot
  // PUT the blob, so we throw to keep the entity queued rather than
  // reference a blob that was never stored.
  if (!/^https?:\/\//i.test(target)) {
    throw new ApiError(
      'Storage did not return a device-uploadable presigned URL',
      502,
      target,
      null
    )
  }

  let put: Response
  try {
    put = await fetch(target, {
      method: 'PUT',
      headers: { 'Content-Type': mimeType },
      body: bytes
    })
  } catch (cause) {
    throw new ApiError(
      cause instanceof Error ? cause.message : 'Media PUT failed',
      0,
      target,
      null
    )
  }
  if (!put.ok) {
    throw new ApiError(`Media PUT failed with ${put.status}`, put.status, target, null)
  }
  return meta.data.document.fileUrl
}

/** True when a URI points at on-device storage that still needs uploading. */
export function isLocalUri(uri: string): boolean {
  return /^file:\/\//i.test(uri) || /^content:\/\//i.test(uri)
}
