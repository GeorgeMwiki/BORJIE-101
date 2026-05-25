/**
 * Tenant brand profile factory + validation.
 *
 * Brand metadata is owned by the tenant and persisted via
 * `@borjie/database`. This module is the pure-function side: build,
 * validate, merge defaults. Persistence is a downstream concern.
 *
 * Reference:
 *   - Research: .audit/litfin-sota-2026-05-23/14-multimodal-generative.md (§7)
 */

import { BrandProfileSchema, type BrandProfile } from '../types.js';

const DEFAULT_FONT_HEADING = 'Inter';
const DEFAULT_FONT_BODY = 'Inter';

export interface BrandProfileInput {
  readonly tenantId: string;
  readonly brandName: string;
  readonly primaryColorOklch: string;
  readonly secondaryColorOklch?: string;
  readonly fontFamilyHeading?: string;
  readonly fontFamilyBody?: string;
  readonly photoStyle?: BrandProfile['photoStyle'];
  readonly loraIds?: ReadonlyArray<string>;
  readonly recraftStyleId?: string;
  readonly elevenLabsVoiceId?: string;
}

export function createBrandProfile(input: BrandProfileInput): BrandProfile {
  const candidate = {
    tenantId: input.tenantId,
    brandName: input.brandName,
    primaryColorOklch: input.primaryColorOklch,
    ...(input.secondaryColorOklch !== undefined && {
      secondaryColorOklch: input.secondaryColorOklch,
    }),
    fontFamilyHeading: input.fontFamilyHeading ?? DEFAULT_FONT_HEADING,
    fontFamilyBody: input.fontFamilyBody ?? DEFAULT_FONT_BODY,
    ...(input.photoStyle !== undefined && { photoStyle: input.photoStyle }),
    loraIds: input.loraIds ? [...input.loraIds] : [],
    ...(input.recraftStyleId !== undefined && { recraftStyleId: input.recraftStyleId }),
    ...(input.elevenLabsVoiceId !== undefined && {
      elevenLabsVoiceId: input.elevenLabsVoiceId,
    }),
  };
  return BrandProfileSchema.parse(candidate);
}
