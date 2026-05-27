import { describe, it, expect } from 'vitest';
import { mapKeyboardEvent, applyNav } from '../a11y/keyboard-nav';

describe('keyboard-nav', () => {
  it('maps j and ArrowDown to "next"', () => {
    expect(mapKeyboardEvent({ key: 'j' })).toEqual({ type: 'next' });
    expect(mapKeyboardEvent({ key: 'ArrowDown' })).toEqual({ type: 'next' });
  });

  it('maps k and ArrowUp to "prev"', () => {
    expect(mapKeyboardEvent({ key: 'k' })).toEqual({ type: 'prev' });
    expect(mapKeyboardEvent({ key: 'ArrowUp' })).toEqual({ type: 'prev' });
  });

  it('suppresses bindings when a modifier is held', () => {
    expect(mapKeyboardEvent({ key: 'j', metaKey: true })).toBeNull();
    expect(mapKeyboardEvent({ key: 'k', ctrlKey: true })).toBeNull();
  });

  it('clamps next at the end of the list (no wrap-around)', () => {
    const ids = ['a', 'b', 'c'];
    expect(applyNav(ids, 'c', { type: 'next' })).toBe('c');
    expect(applyNav(ids, 'a', { type: 'prev' })).toBe('a');
  });
});
