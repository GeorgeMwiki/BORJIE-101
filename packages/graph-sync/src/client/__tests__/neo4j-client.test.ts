/**
 * Tests for the runtime password guard added by D7 wave-4.
 *
 * Goal: ensure remote URIs never silently fall back to the default dev
 * credential, while loopback dev workflows remain unaffected.
 */
import { describe, it, expect } from 'vitest';
import {
  assertRemoteNeo4jHasPassword,
  isLoopbackNeo4jUri,
  Neo4jConfigSchema,
  DEFAULT_DEV_PASSWORD,
} from '../neo4j-client.js';

describe('isLoopbackNeo4jUri', () => {
  it('treats localhost as loopback', () => {
    expect(isLoopbackNeo4jUri('bolt://localhost:7687')).toBe(true);
  });

  it('treats 127.0.0.1 as loopback', () => {
    expect(isLoopbackNeo4jUri('neo4j://127.0.0.1:7687')).toBe(true);
  });

  it('treats remote DNS hosts as non-loopback', () => {
    expect(isLoopbackNeo4jUri('neo4j+s://graph.example.com:7687')).toBe(false);
  });

  it('rejects unknown schemes (fail-closed)', () => {
    expect(isLoopbackNeo4jUri('http://localhost:7687')).toBe(false);
  });

  it('rejects unparseable URIs (fail-closed)', () => {
    expect(isLoopbackNeo4jUri('not-a-url')).toBe(false);
  });
});

describe('assertRemoteNeo4jHasPassword', () => {
  const baseConfig = Neo4jConfigSchema.parse({});

  it('allows loopback URI with default credentials', () => {
    expect(() => assertRemoteNeo4jHasPassword(baseConfig)).not.toThrow();
  });

  it('rejects remote URI with default dev password', () => {
    const cfg = Neo4jConfigSchema.parse({
      uri: 'neo4j+s://graph.example.com:7687',
    });
    expect(() => assertRemoteNeo4jHasPassword(cfg)).toThrow(
      /NEO4J_PASSWORD_REQUIRED/,
    );
  });

  it('rejects remote URI with empty/whitespace password', () => {
    const cfg = Neo4jConfigSchema.parse({
      uri: 'neo4j+s://graph.example.com:7687',
      password: '   ',
    });
    expect(() => assertRemoteNeo4jHasPassword(cfg)).toThrow(
      /NEO4J_PASSWORD_REQUIRED/,
    );
  });

  it('accepts remote URI with explicit non-default password', () => {
    const cfg = Neo4jConfigSchema.parse({
      uri: 'neo4j+s://graph.example.com:7687',
      password: 'a-real-rotated-secret',
    });
    expect(() => assertRemoteNeo4jHasPassword(cfg)).not.toThrow();
  });

  it('attaches NEO4J_PASSWORD_REQUIRED error code', () => {
    const cfg = Neo4jConfigSchema.parse({
      uri: 'bolt+s://prod.example.com:7687',
    });
    try {
      assertRemoteNeo4jHasPassword(cfg);
      throw new Error('expected throw');
    } catch (err) {
      expect((err as Error & { code?: string }).code).toBe(
        'NEO4J_PASSWORD_REQUIRED',
      );
    }
  });

  it('still rejects when explicit password equals built-in default', () => {
    const cfg = Neo4jConfigSchema.parse({
      uri: 'neo4j+s://graph.example.com:7687',
      password: DEFAULT_DEV_PASSWORD,
    });
    expect(() => assertRemoteNeo4jHasPassword(cfg)).toThrow(
      /NEO4J_PASSWORD_REQUIRED/,
    );
  });
});
