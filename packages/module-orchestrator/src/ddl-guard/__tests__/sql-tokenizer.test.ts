import { describe, it, expect } from 'vitest';
import { tokenizeSql, containsPlaceholder } from '../sql-tokenizer.js';

describe('sql-tokenizer', () => {
  it('splits simple statements on top-level semicolons', () => {
    const r = tokenizeSql('CREATE TABLE a (x int); CREATE INDEX i ON a (x);');
    expect(r.statements).toHaveLength(2);
    expect(r.unterminated).toBe(false);
  });

  it('strips line comments into placeholders', () => {
    const r = tokenizeSql('CREATE TABLE a (x int); -- DROP TABLE core\n');
    expect(r.stripped.some((s) => s.kind === 'line-comment')).toBe(true);
    // The DROP hidden in the comment must not appear as a statement.
    expect(r.statements.join(' ')).not.toMatch(/DROP/);
  });

  it('strips block comments, including nested blocks', () => {
    const r = tokenizeSql('CREATE TABLE a (x int) /* outer /* inner DROP */ still */ ;');
    expect(r.stripped.some((s) => s.kind === 'block-comment')).toBe(true);
    expect(r.unterminated).toBe(false);
    expect(r.statements.join(' ')).not.toMatch(/DROP/);
  });

  it('treats a semicolon inside a single-quoted literal as NOT a separator', () => {
    const r = tokenizeSql("INSERT INTO a VALUES ('; DROP TABLE core; --')");
    // Only one statement — the literal hid the ';'.
    expect(r.statements).toHaveLength(1);
    expect(r.stripped.some((s) => s.kind === 'single-quote')).toBe(true);
    // DROP is inside the stripped literal, not the normalized stream.
    expect(r.normalizedSql).not.toMatch(/DROP/);
  });

  it('handles doubled single-quote escapes', () => {
    const r = tokenizeSql("SELECT 'it''s fine; not a split'");
    expect(r.statements).toHaveLength(1);
    expect(r.unterminated).toBe(false);
  });

  it('strips dollar-quoted bodies ($$…$$) and ignores semicolons inside', () => {
    const r = tokenizeSql('DO $$ BEGIN PERFORM 1; PERFORM 2; END $$;');
    // The dollar body absorbs the inner semicolons → single statement.
    expect(r.statements).toHaveLength(1);
    expect(r.stripped.some((s) => s.kind === 'dollar-quote')).toBe(true);
  });

  it('strips tagged dollar-quoted bodies ($tag$…$tag$)', () => {
    const r = tokenizeSql('DO $pol$ CREATE POLICY p; DROP TABLE x; $pol$;');
    expect(r.statements).toHaveLength(1);
    const span = r.stripped.find((s) => s.kind === 'dollar-quote');
    expect(span?.dollarTag).toBe('pol');
    expect(r.normalizedSql).not.toMatch(/DROP/);
  });

  it('flags an unterminated block comment', () => {
    const r = tokenizeSql('CREATE TABLE a (x int) /* never closed');
    expect(r.unterminated).toBe(true);
  });

  it('flags an unterminated string literal', () => {
    const r = tokenizeSql("CREATE TABLE a (x int); SELECT 'open");
    expect(r.unterminated).toBe(true);
  });

  it('flags an unterminated dollar-quote', () => {
    const r = tokenizeSql('DO $$ BEGIN never closed');
    expect(r.unterminated).toBe(true);
  });

  it('containsPlaceholder detects a stripped span placeholder', () => {
    const r = tokenizeSql("x DEFAULT 'lit'");
    expect(containsPlaceholder(r.normalizedSql)).toBe(true);
  });

  it('is pure — identical input yields identical output', () => {
    const sql = 'CREATE TABLE a (x int); -- c\n';
    expect(tokenizeSql(sql)).toEqual(tokenizeSql(sql));
  });
});
