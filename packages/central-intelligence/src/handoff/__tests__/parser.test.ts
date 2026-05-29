/**
 * Parser tests — `<chat_handoff />` extraction from a brain reply.
 *
 * Covers:
 *  - happy path with one well-formed tag
 *  - all attributes including scope payload (siteIds, category, entity)
 *  - dropping invalid persona slug
 *  - dropping duplicate target_user_id
 *  - capping at MAX_HANDOFFS_PER_TURN (6)
 *  - body is always cleaned even when the tag is invalid
 */

import { describe, it, expect } from 'vitest';
import { parseChatHandoffs } from '../parser.js';

describe('parseChatHandoffs', () => {
  it('extracts a single well-formed handoff and strips the tag', () => {
    const text =
      'Sure, Mr. Mwikila — handing off now. ' +
      '<chat_handoff target_user_id="user_john" target_role="T3_module_manager" ' +
      'topic="Mwadui site safety follow-up" />' +
      ' I will let you know when he replies.';

    const result = parseChatHandoffs(text);
    expect(result.handoffs).toHaveLength(1);
    const handoff = result.handoffs[0];
    expect(handoff?.targetUserId).toBe('user_john');
    expect(handoff?.targetRole).toBe('T3_module_manager');
    expect(handoff?.topic).toBe('Mwadui site safety follow-up');
    expect(result.body).not.toContain('<chat_handoff');
    expect(result.body).toContain('handing off now');
    expect(result.body).toContain('I will let you know');
  });

  it('parses all scope attributes into the typed payload', () => {
    const text =
      '<chat_handoff target_user_id="u1" target_role="T4_field_employee" ' +
      'topic="check pit B drillholes" site_ids="mwadui,buzwagi" ' +
      'category="geology" entity_kind="drill_hole" entity_id="dh_42" ' +
      'source_turn_id="turn_xyz" />';
    const result = parseChatHandoffs(text);
    expect(result.handoffs).toHaveLength(1);
    const scope = result.handoffs[0]?.scopePayload as Record<string, unknown>;
    expect(scope['siteIds']).toEqual(['mwadui', 'buzwagi']);
    expect(scope['category']).toBe('geology');
    expect(scope['entityKind']).toBe('drill_hole');
    expect(scope['entityId']).toBe('dh_42');
    expect(scope['sourceTurnId']).toBe('turn_xyz');
  });

  it('drops a handoff with an invalid persona slug', () => {
    const text =
      '<chat_handoff target_user_id="u1" target_role="T99_invalid_role" ' +
      'topic="anything" />';
    const result = parseChatHandoffs(text);
    expect(result.handoffs).toHaveLength(0);
    expect(result.dropped).toBe(1);
    // Tag should still be stripped from the body even when dropped.
    expect(result.body).not.toContain('<chat_handoff');
  });

  it('drops duplicate target_user_id within one turn', () => {
    const text =
      '<chat_handoff target_user_id="u1" target_role="T3_module_manager" topic="A" />' +
      '<chat_handoff target_user_id="u1" target_role="T3_module_manager" topic="B" />';
    const result = parseChatHandoffs(text);
    expect(result.handoffs).toHaveLength(1);
    expect(result.handoffs[0]?.topic).toBe('A');
    expect(result.dropped).toBe(1);
  });

  it('caps at 6 handoffs per turn', () => {
    const tags = Array.from(
      { length: 8 },
      (_, i) =>
        `<chat_handoff target_user_id="u${i}" target_role="T3_module_manager" topic="t${i}" />`,
    ).join('');
    const result = parseChatHandoffs(tags);
    expect(result.handoffs).toHaveLength(6);
    expect(result.dropped).toBe(2);
  });

  it('returns an empty result when no tag is present', () => {
    const result = parseChatHandoffs('plain reply with no handoffs.');
    expect(result.handoffs).toHaveLength(0);
    expect(result.dropped).toBe(0);
    expect(result.body).toBe('plain reply with no handoffs.');
  });

  it('returns immutable arrays + frozen scope', () => {
    const result = parseChatHandoffs(
      '<chat_handoff target_user_id="u1" target_role="T3_module_manager" ' +
        'topic="x" site_ids="s1" />',
    );
    expect(Object.isFrozen(result.handoffs)).toBe(true);
    expect(Object.isFrozen(result.handoffs[0])).toBe(true);
    expect(Object.isFrozen(result.handoffs[0]?.scopePayload)).toBe(true);
  });
});
