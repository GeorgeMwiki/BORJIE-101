/**
 * Mock owner session shim.
 *
 * Stand-in for the real auth flow until the gateway / api-sdk plug
 * into the workspace's session cookie + JWT contract. Returns a
 * realistic Tanzanian mining-owner profile so the cockpit can render
 * with believable identity / tenant context end-to-end.
 *
 * The real implementation will (1) read the platform session cookie,
 * (2) resolve the tenant via @borjie/api-sdk, and (3) hydrate the
 * owner's persona + LMBM summary. This shim mirrors that shape so
 * components can be written against the final contract today.
 *
 * `languagePreference` is the one place the cockpit decides which
 * language to render. It is resolved per-request from the
 * `borjie_locale` cookie (default 'en') so the dashboard, chat, and
 * command palette all agree with the layout chrome — no EN/SW mixing.
 */

import { readLocaleFromServerCookies } from './locale.server';

export interface SiteSummary {
  readonly id: string;
  readonly name: string;
  readonly region: string;
  readonly mineral: 'gold' | 'coltan' | 'tanzanite' | 'gemstone';
  readonly status: 'active' | 'standby' | 'permitting';
}

export interface OwnerSession {
  readonly userId: string;
  readonly fullName: string;
  readonly salutation: string;
  readonly languagePreference: 'sw' | 'en';
  readonly role: 'owner';
  readonly tenant: {
    readonly id: string;
    readonly legalName: string;
    readonly tradingName: string;
    readonly region: string;
    readonly plan: 'kampuni' | 'mtu_mmoja' | 'group';
  };
  readonly sites: ReadonlyArray<SiteSummary>;
  readonly activeSiteId: string;
}

const OWNER_SESSION: OwnerSession = {
  userId: 'usr_owner_001',
  fullName: 'Mzee Mwanaidi Komba',
  salutation: 'Mzee Mwanaidi',
  languagePreference: 'en',
  role: 'owner',
  tenant: {
    id: 'tnt_mawebora',
    legalName: 'Mawe Bora Mining Ltd',
    tradingName: 'Mawe Bora',
    region: 'Geita',
    plan: 'kampuni',
  },
  sites: [
    {
      id: 'site_nyakabale',
      name: 'Nyakabale Reef Block',
      region: 'Geita',
      mineral: 'gold',
      status: 'active',
    },
    {
      id: 'site_kakola',
      name: 'Kakola Alluvial Terraces',
      region: 'Geita',
      mineral: 'gold',
      status: 'active',
    },
    {
      id: 'site_mbeya_ridge',
      name: 'Mbeya Ridge Pit 2',
      region: 'Mbeya',
      mineral: 'coltan',
      status: 'standby',
    },
  ],
  activeSiteId: 'site_nyakabale',
};

export async function getOwnerSession(): Promise<OwnerSession> {
  // Resolve language per-request from the `borjie_locale` cookie so the
  // whole cockpit renders one language (default 'en'). Immutable: spread
  // the frozen base and override only the language field.
  const languagePreference = await readLocaleFromServerCookies();
  return { ...OWNER_SESSION, languagePreference };
}
