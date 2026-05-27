/**
 * mining-graph tests — verify each wrapper produces a tenant-scoped
 * CypherQuery with the expected pattern shape.
 */
import { describe, expect, it } from 'vitest';
import {
  buyerNetwork,
  licencePermitHierarchy,
  MINING_LABELS,
  MINING_REL_TYPES,
  supplyChainProvenance,
  workerCertificationGraph,
} from '../domain/mining-graph.js';
import { GraphDatabaseError } from '../types.js';

describe('mining-graph wrappers', () => {
  describe('licencePermitHierarchy', () => {
    it('emits the full hierarchy projection', () => {
      const q = licencePermitHierarchy({ tenantId: 'tnt-1', limit: 100 });
      expect(q.tenantScoped).toBe(true);
      expect(q.cypher).toContain(`MATCH (l:${MINING_LABELS.Licence}`);
      expect(q.cypher).toContain(`-[:${MINING_REL_TYPES.GRANTS}]->`);
      expect(q.cypher).toContain(`MATCH (p:${MINING_LABELS.Permit}`);
      expect(q.cypher).toContain(`MATCH (m:${MINING_LABELS.Mine}`);
      expect(q.cypher).toContain(`OPTIONAL MATCH (w:${MINING_LABELS.Worker}`);
      expect(q.cypher).toContain('LIMIT 100');
      expect(q.params['tenantId']).toBe('tnt-1');
    });

    it('rejects empty tenantId', () => {
      expect(() => licencePermitHierarchy({ tenantId: '' })).toThrow(
        GraphDatabaseError,
      );
    });
  });

  describe('supplyChainProvenance', () => {
    it('walks the custody chain forward', () => {
      const q = supplyChainProvenance({
        tenantId: 'tnt-1',
        mineralLotId: 'lot-9',
      });
      expect(q.cypher).toContain(`(lot:${MINING_LABELS.MineralLot}`);
      expect(q.cypher).toContain(`-[:${MINING_REL_TYPES.CUSTODY_TO}]->`);
      expect(q.cypher).toContain(`OPTIONAL MATCH (ex:${MINING_LABELS.Export}`);
      expect(q.cypher).toContain(`OPTIONAL MATCH (sale:${MINING_LABELS.Sale}`);
      expect(q.params['mineralLotId']).toBe('lot-9');
      expect(q.params['tenantId']).toBe('tnt-1');
    });

    it('rejects empty mineralLotId', () => {
      expect(() =>
        supplyChainProvenance({ tenantId: 'tnt-1', mineralLotId: '' }),
      ).toThrow(GraphDatabaseError);
    });
  });

  describe('workerCertificationGraph', () => {
    it('emits Worker → Certification → Regulator', () => {
      const q = workerCertificationGraph({
        tenantId: 'tnt-1',
        workerId: 'wkr-7',
      });
      expect(q.cypher).toContain(`(w:${MINING_LABELS.Worker}`);
      expect(q.cypher).toContain(`-[:${MINING_REL_TYPES.HOLDS}]->`);
      expect(q.cypher).toContain(`-[:${MINING_REL_TYPES.ISSUED_BY}]->`);
      expect(q.cypher).toContain(`(r:${MINING_LABELS.Regulator}`);
      expect(q.params['workerId']).toBe('wkr-7');
    });
  });

  describe('buyerNetwork', () => {
    it('bipartite query without buyerId binds buyer:Buyer', () => {
      const q = buyerNetwork({ tenantId: 'tnt-1' });
      expect(q.cypher).toContain(`(b:${MINING_LABELS.Buyer}`);
      expect(q.cypher).toContain(`-[:${MINING_REL_TYPES.BOUGHT_FROM}]->`);
      expect(q.cypher).toContain(`-[:${MINING_REL_TYPES.INTERESTED_IN}]->`);
      expect(q.cypher).toContain(`(mineral:${MINING_LABELS.Mineral}`);
    });

    it('with buyerId injects param binding', () => {
      const q = buyerNetwork({
        tenantId: 'tnt-1',
        buyerId: 'byr-1',
        limit: 10,
      });
      expect(q.params['buyerId']).toBe('byr-1');
      expect(q.cypher).toContain('LIMIT 10');
    });
  });
});
