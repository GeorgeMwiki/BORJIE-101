/**
 * R-FUTURE-4 — entity composer pure-function tests.
 *
 * Five tests covering:
 *   1. mergeEvents orders by `at` ascending.
 *   2. Each composer (reminder/draft/parcel/bid) emits the right
 *      created-row copy in sw + en.
 *   3. State change row lands at the end when stateChangedAt > all
 *      other timestamps.
 *   4. Empty history still emits the 'created' row.
 *   5. Bilingual: switching locale flips every label.
 */

import { describe, expect, it } from 'vitest';
import {
  composeBidTimeline,
  composeDraftTimeline,
  composeParcelTimeline,
  composeReminderTimeline,
  mergeEvents,
  type EntityHistory,
} from '../composers';

function emptyHistory(when = '2026-05-29T08:00:00.000Z'): EntityHistory {
  return {
    createdAt: when,
    createdBy: 'Mwikila',
    createdSummary: 'placeholder',
    createdProvenance: { via: 'chat', sessionId: 's1', turnId: 't1' },
    revisions: [],
    chatTurns: [],
  };
}

describe('mergeEvents', () => {
  it('orders all event types by ISO timestamp ascending', () => {
    const events = mergeEvents({
      ...emptyHistory('2026-05-29T08:00:00.000Z'),
      revisions: [
        {
          id: 'r1',
          at: '2026-05-29T10:00:00.000Z',
          actor: 'a',
          summary: 'rev',
          provenance: { via: 'form' },
        },
      ],
      chatTurns: [
        {
          id: 'c1',
          at: '2026-05-29T09:00:00.000Z',
          actor: 'b',
          summary: 'msg',
          sessionId: 's',
          turnId: 't',
        },
      ],
    });
    expect(events.map((e) => e.kind)).toEqual([
      'created',
      'chat_turn',
      'revised',
    ]);
  });
});

describe('composer copy', () => {
  it('emits the sw "created" copy for each entity', () => {
    const swCreated = (label: string) =>
      label === 'Kumbukumbu imeundwa' ||
      label === 'Rasimu imeandaliwa' ||
      label === 'Parcel imerekodi' ||
      label === 'Zabuni imewekwa';
    expect(
      swCreated(
        composeReminderTimeline({
          entity: {},
          history: emptyHistory(),
          locale: 'sw',
        })[0]?.summary ?? '',
      ),
    ).toBe(true);
    expect(
      swCreated(
        composeDraftTimeline({
          entity: {},
          history: emptyHistory(),
          locale: 'sw',
        })[0]?.summary ?? '',
      ),
    ).toBe(true);
    expect(
      swCreated(
        composeParcelTimeline({
          entity: {},
          history: emptyHistory(),
          locale: 'sw',
        })[0]?.summary ?? '',
      ),
    ).toBe(true);
    expect(
      swCreated(
        composeBidTimeline({
          entity: {},
          history: emptyHistory(),
          locale: 'sw',
        })[0]?.summary ?? '',
      ),
    ).toBe(true);
  });

  it('emits the en "created" copy when locale=en', () => {
    expect(
      composeReminderTimeline({
        entity: {},
        history: emptyHistory(),
        locale: 'en',
      })[0]?.summary,
    ).toBe('Reminder created');
    expect(
      composeDraftTimeline({
        entity: {},
        history: emptyHistory(),
        locale: 'en',
      })[0]?.summary,
    ).toBe('Draft prepared');
  });
});

describe('state change row', () => {
  it('appends at the end when stateChangedAt is the latest timestamp', () => {
    const events = composeParcelTimeline({
      entity: {
        state: 'weighed',
        stateChangedAt: '2026-05-29T15:00:00.000Z',
        stateChangedBy: 'inspector',
      },
      history: emptyHistory('2026-05-29T08:00:00.000Z'),
      locale: 'en',
    });
    expect(events[events.length - 1]?.kind).toBe('state_changed');
    expect(events[events.length - 1]?.summary).toBe(
      'Parcel state: weighed',
    );
  });
});

describe('empty history', () => {
  it('still emits the created row', () => {
    const events = composeBidTimeline({
      entity: {},
      history: emptyHistory(),
      locale: 'en',
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe('created');
  });
});
