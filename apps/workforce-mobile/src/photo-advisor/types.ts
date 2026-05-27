import { z } from 'zod'

/**
 * Wire contract for the workforce-mobile Photo Advisor feature.
 *
 * The feature captures a single still image plus optional natural-language
 * prompt plus optional GPS fix, and asks the Brain to return contextual
 * mining advice for the depicted site / building / area.
 *
 * Today the Brain `POST /api/v1/brain/turn` endpoint only accepts a
 * `userText: string` body — there is no `attachments`, `media`, or
 * `imageUrl` field. The neighbouring `POST /api/v1/ai-native/inspections/
 * :id/analyze` endpoint accepts media, but it requires (a) a pre-existing
 * inspection row keyed by `inspectionId` and (b) signed URLs not raw
 * base64. Neither matches the "show me what this place needs" flow the
 * pilot demands.
 *
 * Until the api-gateway gains a vision-capable brain endpoint, the
 * pipeline below intentionally surfaces a `BACKEND_VISION_UNAVAILABLE`
 * empty state instead of round-tripping a half-built request. The schemas
 * still ship today so that backend integration is a single endpoint swap.
 */

export const PhotoAdvisorLocationSchema = z.object({
  latitude: z.number().finite(),
  longitude: z.number().finite(),
  accuracyMetres: z.number().finite().nullable(),
  capturedAt: z.number().int().nonnegative()
})

export const PhotoAdvisorImageSchema = z.object({
  uri: z.string().min(1),
  base64: z.string().min(1),
  mimeType: z.string().min(1).default('image/jpeg'),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  capturedAt: z.number().int().nonnegative()
})

export const PhotoAdvisorRequestSchema = z.object({
  image: PhotoAdvisorImageSchema,
  prompt: z.string().max(2_000).nullable(),
  location: PhotoAdvisorLocationSchema.nullable(),
  lang: z.enum(['sw', 'en'])
})

export const PhotoAdvisorCitationSchema = z.object({
  evidenceId: z.string().min(1),
  source: z.string().min(1),
  excerpt: z.string().min(1)
})

export const PhotoAdvisorResponseSchema = z.object({
  summary: z.string().min(1),
  reasoning: z.string().min(1),
  suggestions: z.array(z.string().min(1)),
  citations: z.array(PhotoAdvisorCitationSchema)
})

export type PhotoAdvisorLocation = z.infer<typeof PhotoAdvisorLocationSchema>
export type PhotoAdvisorImage = z.infer<typeof PhotoAdvisorImageSchema>
export type PhotoAdvisorRequest = z.infer<typeof PhotoAdvisorRequestSchema>
export type PhotoAdvisorCitation = z.infer<typeof PhotoAdvisorCitationSchema>
export type PhotoAdvisorResponse = z.infer<typeof PhotoAdvisorResponseSchema>

export type PhotoAdvisorErrorCode =
  | 'BACKEND_VISION_UNAVAILABLE'
  | 'UNAUTHENTICATED'
  | 'MALFORMED_RESPONSE'
  | 'NETWORK'
  | 'UNKNOWN'

export interface PhotoAdvisorError {
  code: PhotoAdvisorErrorCode
  message: string
  details?: Readonly<Record<string, unknown>>
}

/**
 * Public function shape. Returns the typed advisor response on success,
 * and throws a `PhotoAdvisorError`-shaped object on failure. Pure async
 * function with no React imports.
 */
export interface AnalyzePhotoArgs {
  uri: string
  base64: string
  mimeType?: string
  width: number
  height: number
  prompt: string | null
  location: PhotoAdvisorLocation | null
  lang: 'sw' | 'en'
}

/**
 * Exact contract the api-gateway must implement before this feature can
 * ship a real reply. Surfaced in the UI empty state so backend agents
 * know precisely what to wire.
 */
export const REQUIRED_BACKEND_CONTRACT = {
  method: 'POST',
  path: '/api/v1/mining/brain/vision-turn',
  requestExample: {
    userText: 'Niambie kuhusu eneo hili',
    lang: 'sw',
    location: { latitude: -3.4287, longitude: 32.9183, accuracyMetres: 8 },
    image: { base64: '<jpeg-base64>', mimeType: 'image/jpeg' }
  },
  responseShape: {
    summary: 'string',
    reasoning: 'string',
    suggestions: ['string'],
    citations: [{ evidenceId: 'string', source: 'string', excerpt: 'string' }]
  }
} as const
