/**
 * Wave SUPERPOWERS (admin-web) — unit coverage for the chip primitives.
 *
 * Validates the chip schemas (zod), the proposedAction → chip mapper,
 * and the bus event publication. The actual chip renderer + drawer are
 * thin React shells over these primitives; their behaviour follows
 * from validated chip data so we cover the contract at the schema +
 * mapper layer.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import {
  uiNavigateChipSchema,
  uiPrefillChipSchema,
  uiHighlightChipSchema,
  uiShareChipSchema,
  uiBulkChipSchema,
  uiBookmarkChipSchema,
  ADMIN_BULK_ACTIONS,
  ADMIN_BULK_ENTITY_TYPES,
  HIGH_IMPACT_ADMIN_ACTIONS,
} from '@/components/superpowers/chip-schemas';
import {
  emitAdminChip,
  ADMIN_CHIP_EMIT_EVENT_NAME,
} from '@/components/superpowers/use-admin-chip-emissions';
import { mapProposedActionToChip } from '@/components/superpowers/proposed-action-mapper';
import {
  publishAdminFormPrefill,
  publishAdminHighlight,
  openAdminBulkDrawer,
  ADMIN_FORM_PREFILL_EVENT_NAME,
  ADMIN_HIGHLIGHT_EVENT_NAME,
  ADMIN_BULK_DRAWER_EVENT_NAME,
} from '@/components/superpowers/bus';

describe('Admin superpower chip schemas', () => {
  it('uiNavigateChipSchema accepts a valid navigate chip', () => {
    const ok = uiNavigateChipSchema.safeParse({
      route: '/internal/tenants',
      reason: 'navigate to tenants',
      scopeIds: ['tenant_a'],
      focus: 'expiring-30d',
    });
    expect(ok.success).toBe(true);
  });

  it('uiNavigateChipSchema rejects non-leading-slash routes', () => {
    const bad = uiNavigateChipSchema.safeParse({
      route: 'tenants',
      reason: 'broken',
    });
    expect(bad.success).toBe(false);
  });

  it('uiPrefillChipSchema accepts primitive value maps', () => {
    const ok = uiPrefillChipSchema.safeParse({
      formId: 'tenant-suspend-form',
      values: { reason: 'fraud', urgency: 3, freeze: true, note: null },
    });
    expect(ok.success).toBe(true);
  });

  it('uiHighlightChipSchema requires bilingual message', () => {
    const ok = uiHighlightChipSchema.safeParse({
      selector: '#killswitch',
      message: { en: 'Tap here', sw: 'Bonyeza hapa' },
      tone: 'warning',
    });
    expect(ok.success).toBe(true);
    const bad = uiHighlightChipSchema.safeParse({
      selector: '#killswitch',
      message: { en: 'Tap here' },
    });
    expect(bad.success).toBe(false);
  });

  it('uiShareChipSchema enforces hours bound + permission enum', () => {
    const ok = uiShareChipSchema.safeParse({
      entityType: 'audit-log',
      entityId: 'log_123',
      expiresInHours: 24,
      permission: 'read',
    });
    expect(ok.success).toBe(true);
    const bad = uiShareChipSchema.safeParse({
      entityType: 'audit-log',
      entityId: 'log_123',
      expiresInHours: 1,
      permission: 'write',
    });
    expect(bad.success).toBe(false);
  });

  it('uiBulkChipSchema enforces admin entity-type + action whitelist', () => {
    const ok = uiBulkChipSchema.safeParse({
      entityType: 'tenant_orgs',
      ids: ['t_1', 't_2'],
      action: 'suspend',
      reason: 'sanctioned-entity-list-match',
    });
    expect(ok.success).toBe(true);

    const badEntity = uiBulkChipSchema.safeParse({
      entityType: 'employees',
      ids: ['t_1'],
      action: 'suspend',
      reason: 'long enough reason',
    });
    expect(badEntity.success).toBe(false);
  });

  it('uiBookmarkChipSchema accepts a valid bookmark chip', () => {
    const ok = uiBookmarkChipSchema.safeParse({
      entityType: 'tenant_org',
      entityId: 'tenant_xyz',
      label: 'Sandbox tenant',
    });
    expect(ok.success).toBe(true);
  });

  it('HIGH_IMPACT_ADMIN_ACTIONS exposes the four-eye verbs', () => {
    expect(HIGH_IMPACT_ADMIN_ACTIONS.has('suspend')).toBe(true);
    expect(HIGH_IMPACT_ADMIN_ACTIONS.has('export_regulator_pack')).toBe(true);
    expect(HIGH_IMPACT_ADMIN_ACTIONS.has('reindex')).toBe(false);
  });

  it('admin whitelist + actions are non-empty + frozen-ish in shape', () => {
    expect(ADMIN_BULK_ACTIONS.length).toBeGreaterThan(4);
    expect(ADMIN_BULK_ENTITY_TYPES.length).toBeGreaterThan(3);
  });
});

describe('mapProposedActionToChip', () => {
  let emitted: ReadonlyArray<{ family: string; turnKey: string }>;

  beforeEach(() => {
    emitted = [];
    window.addEventListener(ADMIN_CHIP_EMIT_EVENT_NAME, (e: Event) => {
      const d = (e as CustomEvent<{ family: string; turnKey: string }>)
        .detail;
      emitted = [...emitted, { family: d.family, turnKey: d.turnKey }];
    });
  });

  it('returns false for a null proposedAction', () => {
    expect(mapProposedActionToChip('turn_1', null)).toBe(false);
    expect(emitted.length).toBe(0);
  });

  it('maps mining.ui.navigate → ui_navigate emission', () => {
    const ok = mapProposedActionToChip('turn_1', {
      action: 'mining.ui.navigate',
      args: {
        route: '/internal/tenants',
        reason: 'show me suspect tenants',
      },
    });
    expect(ok).toBe(true);
    expect(emitted.some((e) => e.family === 'ui_navigate')).toBe(true);
  });

  it('maps mining.ui.bookmark → ui_bookmark emission', () => {
    const ok = mapProposedActionToChip('turn_2', {
      action: 'mining.ui.bookmark',
      args: { entityType: 'tenant_org', entityId: 'tenant_xyz' },
    });
    expect(ok).toBe(true);
    expect(emitted.some((e) => e.family === 'ui_bookmark')).toBe(true);
  });

  it('maps admin.ui.bulk_action with valid args', () => {
    const ok = mapProposedActionToChip('turn_3', {
      action: 'admin.ui.bulk_action',
      args: {
        entityType: 'tenant_orgs',
        ids: ['t_a', 't_b'],
        action: 'export_regulator_pack',
        reason: 'TMAA regulator demand 2026-Q1',
      },
    });
    expect(ok).toBe(true);
    expect(emitted.some((e) => e.family === 'ui_bulk')).toBe(true);
  });

  it('skips unrelated actions silently', () => {
    const ok = mapProposedActionToChip('turn_4', {
      action: 'unrelated.tool',
      args: {},
    });
    expect(ok).toBe(false);
    expect(emitted.length).toBe(0);
  });

  it('skips chip-family actions with invalid args', () => {
    const ok = mapProposedActionToChip('turn_5', {
      action: 'mining.ui.navigate',
      args: { route: 'no-leading-slash', reason: 'bad' },
    });
    expect(ok).toBe(false);
  });
});

describe('Admin superpowers bus', () => {
  it('publishAdminFormPrefill fires a CustomEvent with detail', () => {
    let detail: unknown = null;
    const listener = (e: Event): void => {
      detail = (e as CustomEvent<unknown>).detail;
    };
    window.addEventListener(ADMIN_FORM_PREFILL_EVENT_NAME, listener);
    publishAdminFormPrefill({
      formId: 'tenant-suspend-form',
      values: { reason: 'fraud' },
      submitOnAccept: false,
    });
    window.removeEventListener(ADMIN_FORM_PREFILL_EVENT_NAME, listener);
    expect(detail).toMatchObject({ formId: 'tenant-suspend-form' });
  });

  it('publishAdminHighlight fires a CustomEvent', () => {
    let fired = false;
    const listener = (): void => {
      fired = true;
    };
    window.addEventListener(ADMIN_HIGHLIGHT_EVENT_NAME, listener);
    publishAdminHighlight({
      selector: '#killswitch',
      message: { en: 'here', sw: 'hapa' },
      ttl: 5000,
      tone: 'warning',
    });
    window.removeEventListener(ADMIN_HIGHLIGHT_EVENT_NAME, listener);
    expect(fired).toBe(true);
  });

  it('openAdminBulkDrawer fires the drawer-open event', () => {
    let fired = false;
    const listener = (): void => {
      fired = true;
    };
    window.addEventListener(ADMIN_BULK_DRAWER_EVENT_NAME, listener);
    openAdminBulkDrawer();
    window.removeEventListener(ADMIN_BULK_DRAWER_EVENT_NAME, listener);
    expect(fired).toBe(true);
  });

  it('emitAdminChip publishes via the bus', () => {
    let detail: { turnKey?: string } | null = null;
    const listener = (e: Event): void => {
      detail = (e as CustomEvent<{ turnKey: string }>).detail;
    };
    window.addEventListener(ADMIN_CHIP_EMIT_EVENT_NAME, listener);
    emitAdminChip({
      turnKey: 'turn_x',
      family: 'ui_highlight',
      chip: {
        selector: '#x',
        message: { en: 'x', sw: 'x' },
      },
    });
    window.removeEventListener(ADMIN_CHIP_EMIT_EVENT_NAME, listener);
    expect(detail).toMatchObject({ turnKey: 'turn_x' });
  });
});
