/**
 * Tenant Isolation Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  TenantIsolationEnforcer,
  TenantIsolationError,
  runWithTenantContext,
  getCurrentTenantContext,
  requireTenantContext,
  createTenantEnforcer,
  type TenantContext,
} from './tenant-isolation.js';
import { asTenantId, asUserId, type TenantScoped, type TenantId } from '@borjie/domain-models';

interface MockEntity extends TenantScoped {
  id: string;
  name: string;
  tenantId: TenantId;
}

const createMockEntity = (tenantId: string, id: string): MockEntity => ({
  id,
  name: `Entity ${id}`,
  tenantId: asTenantId(tenantId),
});

describe('TenantIsolationEnforcer', () => {
  let enforcer: TenantIsolationEnforcer;
  let context: TenantContext;
  
  beforeEach(() => {
    context = {
      tenantId: asTenantId('tenant-1'),
      isSuperAdmin: false,
    };
    enforcer = new TenantIsolationEnforcer(context);
  });
  
  describe('assertTenantMatch', () => {
    it('should return entity if tenant matches', () => {
      const entity = createMockEntity('tenant-1', 'entity-1');
      const result = enforcer.assertTenantMatch(entity);
      expect(result).toBe(entity);
    });
    
    it('should throw TenantIsolationError if tenant does not match', () => {
      const entity = createMockEntity('tenant-2', 'entity-1');
      expect(() => enforcer.assertTenantMatch(entity)).toThrow(TenantIsolationError);
    });
    
    it('should allow cross-tenant access for super admin', () => {
      const superContext: TenantContext = {
        tenantId: asTenantId('tenant-1'),
        isSuperAdmin: true,
      };
      const superEnforcer = new TenantIsolationEnforcer(superContext);
      
      const entity = createMockEntity('tenant-2', 'entity-1');
      const result = superEnforcer.assertTenantMatch(entity);
      expect(result).toBe(entity);
    });
  });
  
  describe('assertTenantId', () => {
    it('should not throw if tenant ID matches', () => {
      expect(() => enforcer.assertTenantId(asTenantId('tenant-1'))).not.toThrow();
    });
    
    it('should throw TenantIsolationError if tenant ID does not match', () => {
      expect(() => enforcer.assertTenantId(asTenantId('tenant-2'))).toThrow(TenantIsolationError);
    });
  });
  
  describe('filterTenantEntities', () => {
    it('should filter to only matching tenant entities', () => {
      const entities = [
        createMockEntity('tenant-1', 'entity-1'),
        createMockEntity('tenant-2', 'entity-2'),
        createMockEntity('tenant-1', 'entity-3'),
      ];
      
      const filtered = enforcer.filterTenantEntities(entities);
      
      expect(filtered).toHaveLength(2);
      expect(filtered.map(e => e.id)).toEqual(['entity-1', 'entity-3']);
    });
    
    it('should return all entities for super admin', () => {
      const superContext: TenantContext = {
        tenantId: asTenantId('tenant-1'),
        isSuperAdmin: true,
      };
      const superEnforcer = new TenantIsolationEnforcer(superContext);
      
      const entities = [
        createMockEntity('tenant-1', 'entity-1'),
        createMockEntity('tenant-2', 'entity-2'),
      ];
      
      const filtered = superEnforcer.filterTenantEntities(entities);
      expect(filtered).toHaveLength(2);
    });
  });
  
  describe('validateEntity', () => {
    it('should return entity if tenant matches', () => {
      const entity = createMockEntity('tenant-1', 'entity-1');
      expect(enforcer.validateEntity(entity)).toBe(entity);
    });
    
    it('should return null if tenant does not match', () => {
      const entity = createMockEntity('tenant-2', 'entity-1');
      expect(enforcer.validateEntity(entity)).toBeNull();
    });
    
    it('should return null for null/undefined', () => {
      expect(enforcer.validateEntity(null)).toBeNull();
      expect(enforcer.validateEntity(undefined)).toBeNull();
    });
  });
  
  describe('scopeQuery', () => {
    it('should add tenantId to query object', () => {
      const query = { name: 'search', status: 'active' };
      const scoped = enforcer.scopeQuery(query);
      
      expect(scoped).toEqual({
        name: 'search',
        status: 'active',
        tenantId: asTenantId('tenant-1'),
      });
    });
  });
});

describe('TenantIsolationError', () => {
  it('should include expected and actual tenant IDs', () => {
    const error = new TenantIsolationError(
      asTenantId('tenant-1'),
      asTenantId('tenant-2')
    );
    
    expect(error.expectedTenantId).toBe('tenant-1');
    expect(error.actualTenantId).toBe('tenant-2');
    expect(error.code).toBe('TENANT_ISOLATION_VIOLATION');
    expect(error.message).toContain('tenant-1');
    expect(error.message).toContain('tenant-2');
  });
});

describe('runWithTenantContext', () => {
  it('should provide context within callback', () => {
    const context: TenantContext = {
      tenantId: asTenantId('tenant-1'),
      isSuperAdmin: false,
    };
    
    runWithTenantContext(context, () => {
      const current = getCurrentTenantContext();
      expect(current).toBeDefined();
      expect(current?.tenantId).toBe('tenant-1');
      expect(current?.isSuperAdmin).toBe(false);
    });
  });
  
  it('should not leak context outside callback', () => {
    const context: TenantContext = {
      tenantId: asTenantId('tenant-1'),
      isSuperAdmin: false,
    };
    
    runWithTenantContext(context, () => {
      // Inside context
    });
    
    // Outside context
    expect(getCurrentTenantContext()).toBeUndefined();
  });
  
  it('should allow nested contexts', () => {
    const outerContext: TenantContext = {
      tenantId: asTenantId('tenant-1'),
      isSuperAdmin: false,
    };
    
    const innerContext: TenantContext = {
      tenantId: asTenantId('tenant-2'),
      isSuperAdmin: true,
    };
    
    runWithTenantContext(outerContext, () => {
      expect(getCurrentTenantContext()?.tenantId).toBe('tenant-1');
      
      runWithTenantContext(innerContext, () => {
        expect(getCurrentTenantContext()?.tenantId).toBe('tenant-2');
        expect(getCurrentTenantContext()?.isSuperAdmin).toBe(true);
      });
      
      // Restored to outer context
      expect(getCurrentTenantContext()?.tenantId).toBe('tenant-1');
    });
  });
});

describe('requireTenantContext', () => {
  it('should throw if not in tenant context', () => {
    expect(() => requireTenantContext()).toThrow('No tenant context available');
  });
  
  it('should return context if available', () => {
    const context: TenantContext = {
      tenantId: asTenantId('tenant-1'),
      isSuperAdmin: false,
    };
    
    runWithTenantContext(context, () => {
      expect(() => requireTenantContext()).not.toThrow();
      expect(requireTenantContext().tenantId).toBe('tenant-1');
    });
  });
});

describe('createTenantEnforcer', () => {
  it('should create enforcer from current context', () => {
    const context: TenantContext = {
      tenantId: asTenantId('tenant-1'),
      isSuperAdmin: false,
    };
    
    runWithTenantContext(context, () => {
      const enforcer = createTenantEnforcer();
      expect(enforcer.tenantId).toBe('tenant-1');
      expect(enforcer.allowsCrossTenant).toBe(false);
    });
  });
  
  it('should throw if not in tenant context', () => {
    expect(() => createTenantEnforcer()).toThrow();
  });
});
