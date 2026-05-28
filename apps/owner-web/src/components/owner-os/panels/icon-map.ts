/**
 * Icon-name resolver — maps a descriptor's `iconName` string to the
 * actual lucide-react component. The contract package stores the string
 * (descriptor.iconName) so the package can stay zero-React; the shell
 * uses this table to render the icon at runtime.
 *
 * Adding a new panel that uses a new icon = add ONE line here.
 */

import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  BellRing,
  Briefcase,
  Building2,
  Calculator,
  Coins,
  Edit3,
  FileText,
  FolderOpen,
  Gem,
  HardHat,
  Link as LinkIcon,
  MessageSquare,
  Microscope,
  Mountain,
  Pickaxe,
  Scale,
  ScrollText,
  ShieldAlert,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Sprout,
  Users,
  Wallet,
} from 'lucide-react';

const ICONS: Readonly<Record<string, LucideIcon>> = {
  Activity,
  AlertOctagon,
  AlertTriangle,
  BellRing,
  Briefcase,
  Building2,
  Calculator,
  Coins,
  Edit3,
  FileText,
  FolderOpen,
  Gem,
  HardHat,
  LinkIcon,
  MessageSquare,
  Microscope,
  Mountain,
  Pickaxe,
  Scale,
  ScrollText,
  ShieldAlert,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Sprout,
  Users,
  Wallet,
};

/** Return the lucide-react icon component for a given iconName, or a
 * fallback (Sparkles) if the name is unknown. */
export function resolveIcon(name: string): LucideIcon {
  return ICONS[name] ?? Sparkles;
}
