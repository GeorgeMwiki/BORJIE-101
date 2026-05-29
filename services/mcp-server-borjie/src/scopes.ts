/**
 * Borjie MCP scope model.
 *
 * Scopes are deliberately small and Borjie-mining-domain shaped. Every
 * tool descriptor declares its required scopes; the gateway refuses
 * any call whose token lacks the union of those scopes.
 *
 * Owner scopes are granted by an owner-approved device-flow consent.
 * Admin scopes are only ever issued to Borjie admin tokens, never to
 * external agents acting on behalf of an owner.
 */

import type { BorjieScope } from './types.js';

export interface BorjieScopeDescriptor {
  readonly scope: BorjieScope;
  readonly displayNameEn: string;
  readonly displayNameSw: string;
  readonly descriptionEn: string;
  readonly descriptionSw: string;
  readonly grantableByOwner: boolean;
}

export const BORJIE_SCOPE_CATALOG: ReadonlyArray<BorjieScopeDescriptor> =
  Object.freeze([
    Object.freeze({
      scope: 'owner:read',
      displayNameEn: 'Read estate data',
      displayNameSw: 'Soma data ya mali',
      descriptionEn:
        'Read your estate snapshot — entities, scope nodes, daily brief, opportunities, risks, calibration, decisions.',
      descriptionSw:
        'Soma muhtasari wa mali yako — vitu, vipande, ripoti ya kila siku, fursa, hatari, urekebishaji, maamuzi.',
      grantableByOwner: true,
    }),
    Object.freeze({
      scope: 'owner:write',
      displayNameEn: 'Write actions to your estate',
      displayNameSw: 'Andika vitendo kwa mali yako',
      descriptionEn:
        'Create, update, delete entities (scope nodes, drafts, pinned items) and run scans (opportunity / risk). All writes are hash-chain audited and undoable within the window.',
      descriptionSw:
        'Unda, sasisha, futa vitu (vipande, rasimu, vitu vilivyobandikwa) na endesha skani (fursa / hatari). Maandiko yote yana ukaguzi wa hash-chain na yanaweza kufutwa ndani ya muda.',
      grantableByOwner: true,
    }),
    Object.freeze({
      scope: 'owner:draft',
      displayNameEn: 'Compose, edit, and lock drafts',
      displayNameSw: 'Tunga, hariri, na funga rasimu',
      descriptionEn:
        'Compose free-form drafts (memos, contracts, letters), edit revisions, and lock them on confirm. Locked drafts are immutable.',
      descriptionSw:
        'Tunga rasimu huru (memo, mikataba, barua), hariri marekebisho, na zifunge unapozithibitisha. Rasimu zilizofungwa hazibadiliki.',
      grantableByOwner: true,
    }),
    Object.freeze({
      scope: 'owner:reminders',
      displayNameEn: 'Manage reminders and tabs',
      displayNameSw: 'Dhibiti vikumbusho na tabs',
      descriptionEn:
        'Create / list / cancel reminders, spawn / close cockpit tabs.',
      descriptionSw:
        'Unda / orodhesha / ghairi vikumbusho, fungua / funga tabs za cockpit.',
      grantableByOwner: true,
    }),
    Object.freeze({
      scope: 'owner:share',
      displayNameEn: 'Generate share links',
      displayNameSw: 'Tengeneza viungo vya kushiriki',
      descriptionEn:
        'Generate time-boxed share links for entities so external parties can view with read-only access.',
      descriptionSw:
        'Tengeneza viungo vya muda mfupi vya kushiriki vitu ili wapendwa wa nje waone kwa idhini ya kusoma tu.',
      grantableByOwner: true,
    }),
    Object.freeze({
      scope: 'admin:read',
      displayNameEn: 'Borjie admin — read multi-tenant operational data',
      displayNameSw: 'Borjie admin — soma data ya watumiaji wengi',
      descriptionEn:
        'Borjie internal-only. Read cross-tenant operational data for the admin console.',
      descriptionSw:
        'Ndani ya Borjie tu. Soma data ya watumiaji wengi kwa console ya admin.',
      grantableByOwner: false,
    }),
  ]);

/**
 * Returns the subset of scopes that an owner can grant via the device-
 * flow consent screen. Filters out admin-only scopes.
 */
export function grantableScopesForOwner(): ReadonlyArray<BorjieScope> {
  return Object.freeze(
    BORJIE_SCOPE_CATALOG.filter((d) => d.grantableByOwner).map((d) => d.scope),
  );
}

/**
 * Pure helper — returns true when the granted scope set is a superset
 * of the required scope set. Used by every tool dispatcher in this
 * package and by the api-gateway OAuth route's scope-narrowing logic.
 */
export function hasRequiredScopes(
  granted: ReadonlyArray<BorjieScope>,
  required: ReadonlyArray<BorjieScope>,
): boolean {
  const grantedSet = new Set(granted);
  for (const r of required) {
    if (!grantedSet.has(r)) return false;
  }
  return true;
}
