import { z } from 'zod'

// Each buyer-context tool call carries a different result envelope. We
// keep the schemas here (not in `types.ts`) so the renderer can opt into
// strict parsing while the chat history stays loose. A renderer that
// can't safely parse falls back to a JSON dump and a friendly note.

// --- Marketplace listings ---------------------------------------------------

const SellerSchema = z.object({
  id: z.string(),
  name: z.string(),
  pmlNumber: z.string().optional().default(''),
  rating: z.number().min(0).max(5).optional().default(0),
  verified: z.boolean().optional().default(false)
})

const ListingSchema = z.object({
  id: z.string(),
  mineral: z.string(),
  title: z.string(),
  grade: z.string(),
  quantityKg: z.number(),
  originSite: z.string().optional().default(''),
  originRegion: z.string(),
  seller: SellerSchema,
  priceTzsPerKg: z.number().optional().default(0),
  priceHintTzs: z.number(),
  photos: z.array(z.string()).optional().default([]),
  assayPdfUrl: z.string().optional().default(''),
  assayResults: z.array(z.unknown()).optional().default([]),
  chainOfCustody: z.array(z.string()).optional().default([]),
  listedAt: z.string(),
  status: z.enum(['open', 'reserved', 'closed'])
})

export const MarketplaceListingsResultSchema = z.object({
  listings: z.array(ListingSchema)
})

export type MarketplaceListing = z.infer<typeof ListingSchema>

// --- Active bids ------------------------------------------------------------

const BidMessageSchema = z.object({
  id: z.string(),
  from: z.enum(['buyer', 'seller']),
  body: z.string(),
  sentAt: z.string()
})

const BidSchema = z.object({
  id: z.string(),
  listingId: z.string(),
  listingTitle: z.string(),
  mineral: z.string(),
  offerTzsPerKg: z.number(),
  quantityKg: z.number(),
  status: z.enum(['pending', 'accepted', 'rejected', 'countered']),
  placedAt: z.string(),
  thread: z.array(BidMessageSchema).optional().default([])
})

export const BidsResultSchema = z.object({
  bids: z.array(BidSchema)
})

export type BidSnapshot = z.infer<typeof BidSchema>

// --- KYC status -------------------------------------------------------------

export const KycStatusResultSchema = z.object({
  status: z.enum(['pending', 'submitted', 'approved', 'rejected']),
  message: z.string().optional()
})

// --- Bid recommendation (slide-to-bid card) --------------------------------

export const BidRecommendationResultSchema = z.object({
  listingId: z.string(),
  listingTitle: z.string(),
  mineral: z.string().optional(),
  recommendedTzsPerKg: z.number(),
  quantityKg: z.number(),
  paymentTerms: z.enum(['instant', '30d', '60d']).optional().default('instant'),
  rationale: z.string().optional()
})

export type BidRecommendation = z.infer<typeof BidRecommendationResultSchema>

// --- Deal pipeline counts --------------------------------------------------

export const DealPipelineResultSchema = z.object({
  negotiating: z.number(),
  accepted: z.number(),
  closed: z.number(),
  total: z.number()
})

// Helpers ------------------------------------------------------------------
//
// We always parse the *result* slot if present, otherwise the *args* slot.
// Buyer-side tools surface results, but the orchestrator sometimes only
// echoes the planned args before execution — we accept both shapes.

export function extractPayload(toolCall: { readonly args?: unknown; readonly result?: unknown }): unknown {
  if (toolCall.result !== undefined && toolCall.result !== null) {
    return toolCall.result
  }
  return toolCall.args
}
