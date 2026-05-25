import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DEBOUNCE,
  completeSave,
  failSave,
  initFormState,
  isDirty,
  setValue,
  shouldFireAutosave,
  startSave,
  warnOnLeave,
} from '../form-autosave.js';

const initial = { name: 'Alice', age: 30 };

describe('form-autosave', () => {
  it('initFormState sets idle status with initial values', () => {
    const s = initFormState(initial);
    expect(s.status).toBe('idle');
    expect(s.current).toEqual(initial);
    expect(s.lastSaved).toEqual(initial);
    expect(s.lastSavedAtMs).toBeNull();
  });

  it('setValue marks dirty when values differ', () => {
    const s = setValue(initFormState(initial), { name: 'Bob', age: 30 });
    expect(s.status).toBe('dirty');
    expect(isDirty(s)).toBe(true);
  });

  it('setValue goes back to idle when reverting to saved', () => {
    let s = setValue(initFormState(initial), { name: 'Bob', age: 30 });
    s = setValue(s, initial);
    expect(s.status).toBe('idle');
    expect(isDirty(s)).toBe(false);
  });

  it('startSave moves to saving', () => {
    const s = startSave(setValue(initFormState(initial), { name: 'X', age: 30 }));
    expect(s.status).toBe('saving');
  });

  it('completeSave updates lastSaved + timestamp', () => {
    let s = setValue(initFormState(initial), { name: 'X', age: 30 });
    s = startSave(s);
    s = completeSave(s, 12345);
    expect(s.status).toBe('saved');
    expect(s.lastSaved).toEqual({ name: 'X', age: 30 });
    expect(s.lastSavedAtMs).toBe(12345);
    expect(isDirty(s)).toBe(false);
  });

  it('failSave preserves current + sets error', () => {
    let s = setValue(initFormState(initial), { name: 'X', age: 30 });
    s = startSave(s);
    s = failSave(s, 'network down');
    expect(s.status).toBe('error');
    expect(s.error).toBe('network down');
  });

  it('warnOnLeave true when dirty and not saving', () => {
    const s = setValue(initFormState(initial), { name: 'X', age: 30 });
    expect(warnOnLeave(s)).toBe(true);
  });

  it('warnOnLeave false while saving', () => {
    let s = setValue(initFormState(initial), { name: 'X', age: 30 });
    s = startSave(s);
    expect(warnOnLeave(s)).toBe(false);
  });

  it('warnOnLeave false when clean', () => {
    expect(warnOnLeave(initFormState(initial))).toBe(false);
  });

  it('shouldFireAutosave fires after min delay since keystroke', () => {
    expect(shouldFireAutosave(1000, 0, 1000 + DEFAULT_DEBOUNCE.minDelayMs)).toBe(true);
  });

  it('shouldFireAutosave fires after max delay since last fire', () => {
    expect(shouldFireAutosave(1000, 0, DEFAULT_DEBOUNCE.maxDelayMs + 1)).toBe(true);
  });

  it('shouldFireAutosave does not fire too early', () => {
    expect(shouldFireAutosave(1000, 999, 1100)).toBe(false);
  });

  it('does not mutate prior state', () => {
    const a = initFormState(initial);
    setValue(a, { name: 'Z', age: 99 });
    expect(a.current).toEqual(initial);
  });
});
