import { describe, expect, it } from 'vitest';
import {
  decidePromotion,
  PROMOTION_DISTINCT_USER_THRESHOLD,
  PROMOTION_REUSE_THRESHOLD,
} from '../lifecycle/promotion-decider.js';
import { createReuseCounter } from '../lifecycle/reuse-counter.js';

describe('promotion-decider', () => {
  it('does not promote below the 10× threshold', () => {
    const r = decidePromotion({
      snapshot: { recipe_hash: 'h', count: 9, distinct_user_count: 5 },
      function_id: 'f',
      archetype: 'list_with_filters',
    });
    expect(r.should_promote).toBe(false);
  });

  it('does not promote below the 3-user threshold', () => {
    const r = decidePromotion({
      snapshot: { recipe_hash: 'h', count: 50, distinct_user_count: 2 },
      function_id: 'f',
      archetype: 'list_with_filters',
    });
    expect(r.should_promote).toBe(false);
  });

  it('promotes when both thresholds are met', () => {
    const r = decidePromotion({
      snapshot: {
        recipe_hash: 'h',
        count: PROMOTION_REUSE_THRESHOLD,
        distinct_user_count: PROMOTION_DISTINCT_USER_THRESHOLD,
      },
      function_id: 'project_fx_exposure',
      archetype: 'chart_with_table',
      scope_label: 'mwadui',
      date_iso: '2026-05-26T12:34:56Z',
    });
    expect(r.should_promote).toBe(true);
    if (r.should_promote) {
      expect(r.promotion_recipe_id).toBe(
        'project_fx_exposure-chart_with_table-mwadui-promoted-2026-05-26',
      );
    }
  });

  it('defaults the scope label to "global"', () => {
    const r = decidePromotion({
      snapshot: {
        recipe_hash: 'h',
        count: 10,
        distinct_user_count: 3,
      },
      function_id: 'f',
      archetype: 'kpi_grid',
      date_iso: '2026-01-01T00:00:00Z',
    });
    expect(r.should_promote).toBe(true);
    if (r.should_promote) {
      expect(r.promotion_recipe_id).toContain('-global-promoted-');
    }
  });

  it('integrates with reuse-counter to drive a real promotion', () => {
    const c = createReuseCounter();
    for (let i = 0; i < 10; i++) {
      c.record('h', `user-${i % 3}`); // 10 records across 3 users
    }
    const snap = c.snapshot('h');
    expect(snap).not.toBeNull();
    if (!snap) return;
    const r = decidePromotion({
      snapshot: snap,
      function_id: 'fx',
      archetype: 'chart_with_table',
    });
    expect(r.should_promote).toBe(true);
  });
});
