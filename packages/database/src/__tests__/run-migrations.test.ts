/**
 * Unit tests for the refactored `runMigrations` entry point.
 *
 * These tests verify that:
 *   a) Importing the module does not auto-invoke `runMigrations()` — in
 *      particular it must NOT call `process.exit`. This is the core
 *      requirement that lets us mount the function as a boot-time hook.
 *   b) `runMigrations()` throws a clear error when DATABASE_URL is absent.
 *
 * We never open a real Postgres connection here — case (a) confirms no
 * side-effects on import, and case (b) fails before postgres() is called.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stripWrappingTransaction } from '../run-migrations.js';

describe('stripWrappingTransaction', () => {
  it('strips a simple BEGIN/COMMIT wrapper', () => {
    const sql = 'BEGIN;\nCREATE TABLE t (id int);\nCOMMIT;\n';
    expect(stripWrappingTransaction(sql).trim()).toBe('CREATE TABLE t (id int);');
  });

  it('tolerates leading comments before BEGIN', () => {
    const sql = '-- migration 0099\n-- author\n/* block */\nBEGIN;\nSELECT 1;\nCOMMIT;';
    const out = stripWrappingTransaction(sql);
    expect(out).not.toMatch(/^\s*BEGIN/i);
    expect(out).not.toMatch(/COMMIT\s*;?\s*$/i);
    expect(out).toContain('SELECT 1;');
    // Comments retained
    expect(out).toContain('-- migration 0099');
  });

  it('accepts BEGIN WORK and START TRANSACTION variants', () => {
    expect(stripWrappingTransaction('BEGIN WORK;\nSELECT 1;\nCOMMIT WORK;')).not.toMatch(/BEGIN|COMMIT/i);
    expect(stripWrappingTransaction('START TRANSACTION;\nSELECT 1;\nEND;')).not.toMatch(/START|END/i);
  });

  it('returns content unchanged if no wrapping transaction', () => {
    const sql = 'CREATE TABLE t (id int);\n';
    expect(stripWrappingTransaction(sql)).toBe(sql);
  });

  it('returns content unchanged when only BEGIN is present (asymmetric)', () => {
    const sql = 'BEGIN;\nSELECT 1;';
    expect(stripWrappingTransaction(sql)).toBe(sql);
  });

  it('returns content unchanged when only COMMIT is present (asymmetric)', () => {
    const sql = 'SELECT 1;\nCOMMIT;';
    expect(stripWrappingTransaction(sql)).toBe(sql);
  });

  it('is case-insensitive', () => {
    const sql = 'begin;\nSELECT 1;\ncommit;';
    expect(stripWrappingTransaction(sql)).not.toMatch(/begin|commit/i);
  });

  it('handles trailing whitespace + comment after COMMIT', () => {
    const sql = 'BEGIN;\nSELECT 1;\nCOMMIT;\n-- end of migration\n\n';
    expect(stripWrappingTransaction(sql)).not.toMatch(/COMMIT/i);
  });
});



describe('run-migrations module', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  // Typed as `unknown` to sidestep vitest's awkward overloads around
  // process.exit (which has the `never` return type).
  let exitSpy: unknown;
  let exitCalls = 0;

  beforeEach(() => {
    exitCalls = 0;
    // Spy on process.exit so we can assert it was never called during import.
    // Throw on invocation to make accidental exits loud rather than silent.
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      exitCalls += 1;
      throw new Error(`process.exit called with code=${code ?? 'undefined'}`);
    }) as never);
  });

  afterEach(() => {
    (exitSpy as { mockRestore: () => void }).mockRestore();
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
    vi.resetModules();
  });

  it('does not call process.exit on import (can be safely loaded as a library)', async () => {
    // Importing the module should register exports only — no side-effects.
    const mod = await import('../run-migrations.js');

    expect(typeof mod.runMigrations).toBe('function');
    expect(exitCalls).toBe(0);
  });

  it('throws "DATABASE_URL not set" when both option and env are absent', async () => {
    delete process.env.DATABASE_URL;
    const { runMigrations } = await import('../run-migrations.js');

    await expect(runMigrations()).rejects.toThrow('DATABASE_URL not set');
    expect(exitCalls).toBe(0);
  });
});
