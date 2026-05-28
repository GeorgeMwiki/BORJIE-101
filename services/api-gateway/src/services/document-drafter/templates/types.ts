/**
 * Universal Drafter template module contract.
 *
 * Wave UNIVERSAL-DOC-DRAFTER. The 18 new mining-estate templates are
 * authored as TypeScript modules (not paired markdown files like the
 * v1 templates) so the brain can pass structured fillVars validated by
 * zod and so each template can compose context-aware prose.
 *
 * Older `.sw.md` / `.en.md` paired templates continue to work via the
 * v1 loader in `./index.ts`.
 */

import type { z } from 'zod';
import type { DraftKind, DraftLanguage } from '@borjie/database/schemas';

export interface BilingualTitle {
  readonly en: string;
  readonly sw: string;
}

export interface OwnerProfileLite {
  readonly id?: string;
  readonly displayName?: string;
  readonly tenantTradingName?: string;
  readonly jurisdiction?: string;
}

export interface TemplateComposeContext {
  readonly ownerProfile?: OwnerProfileLite;
  readonly scope?: Record<string, unknown>;
  readonly dataResolvers?: Record<string, (key: string) => Promise<unknown>>;
  readonly language?: DraftLanguage;
  readonly tenantTradingName?: string;
}

export interface TemplateRenderHints {
  readonly preferredFormat?: 'md' | 'pdf' | 'docx' | 'pptx' | 'html';
  readonly classification?: 'public' | 'internal' | 'confidential';
  readonly headerLogo?: boolean;
  readonly coverPage?: boolean;
}

export interface UniversalTemplate {
  readonly id: string;
  readonly title: BilingualTitle;
  readonly kind: DraftKind;
  readonly description: string;
  readonly variables: z.ZodTypeAny;
  readonly composeMarkdown: (
    vars: Record<string, unknown>,
    context: TemplateComposeContext,
  ) => Promise<string> | string;
  readonly renderHints: TemplateRenderHints;
}
