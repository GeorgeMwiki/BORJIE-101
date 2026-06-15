import type { LucideIcon } from 'lucide-react';
import { getMessages } from '@/lib/i18n';

/** The resolved `nav` message bag for the active locale. */
export type NavMessages = ReturnType<typeof getMessages>['nav'];

export interface AudienceItem {
  readonly id: string;
  readonly href: string;
  readonly icon: LucideIcon;
}

export interface AudienceCategory {
  readonly titleKey: 'operators' | 'buyers' | 'ecosystem' | 'capital';
  readonly items: readonly AudienceItem[];
}

export interface PrimaryLink {
  readonly href: string;
  readonly labelKey: 'pricing' | 'buyers' | 'docs';
}
