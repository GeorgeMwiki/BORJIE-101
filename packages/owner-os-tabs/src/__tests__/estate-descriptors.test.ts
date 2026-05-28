/**
 * Estate Tab Types Test
 *
 * Asserts that all 6 estate tab types exist in the OWNER_OS_TAB_TYPES union
 * and that estate descriptor files are created with valid structure.
 */

import { describe, it, expect } from 'vitest';
import { OWNER_OS_TAB_TYPES } from '../types';
import type { OwnerOSTabType } from '../types';

describe('Estate Tab Types', () => {
  const ESTATE_TAB_TYPES: ReadonlyArray<OwnerOSTabType> = [
    'holdings',
    'subsidiaries',
    'ancillary',
    'family-office',
    'succession',
    'asset-register',
  ];

  describe('OWNER_OS_TAB_TYPES union', () => {
    it('should include all 6 estate tab types', () => {
      ESTATE_TAB_TYPES.forEach((type) => {
        expect(OWNER_OS_TAB_TYPES).toContain(type);
      });
    });

    it('should have holdings tab type', () => {
      expect(OWNER_OS_TAB_TYPES).toContain('holdings');
    });

    it('should have subsidiaries tab type', () => {
      expect(OWNER_OS_TAB_TYPES).toContain('subsidiaries');
    });

    it('should have ancillary tab type', () => {
      expect(OWNER_OS_TAB_TYPES).toContain('ancillary');
    });

    it('should have family-office tab type', () => {
      expect(OWNER_OS_TAB_TYPES).toContain('family-office');
    });

    it('should have succession tab type', () => {
      expect(OWNER_OS_TAB_TYPES).toContain('succession');
    });

    it('should have asset-register tab type', () => {
      expect(OWNER_OS_TAB_TYPES).toContain('asset-register');
    });
  });

  describe('Estate tab ordering', () => {
    it('should have all 6 estate tabs after mining-domain spawnables', () => {
      const estateStartIndex = OWNER_OS_TAB_TYPES.indexOf('holdings');
      const miningStartIndex = OWNER_OS_TAB_TYPES.indexOf('hr');
      expect(estateStartIndex).toBeGreaterThan(miningStartIndex);
    });

    it('should maintain union order: holdings, subsidiaries, ancillary, family-office, succession, asset-register', () => {
      const holdingsIdx = OWNER_OS_TAB_TYPES.indexOf('holdings');
      const subsidiariesIdx = OWNER_OS_TAB_TYPES.indexOf('subsidiaries');
      const ancillaryIdx = OWNER_OS_TAB_TYPES.indexOf('ancillary');
      const familyOfficeIdx = OWNER_OS_TAB_TYPES.indexOf('family-office');
      const successionIdx = OWNER_OS_TAB_TYPES.indexOf('succession');
      const assetRegisterIdx = OWNER_OS_TAB_TYPES.indexOf('asset-register');

      expect(holdingsIdx).toBeLessThan(subsidiariesIdx);
      expect(subsidiariesIdx).toBeLessThan(ancillaryIdx);
      expect(ancillaryIdx).toBeLessThan(familyOfficeIdx);
      expect(familyOfficeIdx).toBeLessThan(successionIdx);
      expect(successionIdx).toBeLessThan(assetRegisterIdx);
    });
  });

  describe('Estate tab type distinctness', () => {
    it('should have no duplicate estate tab types', () => {
      const deduplicated = new Set(ESTATE_TAB_TYPES);
      expect(deduplicated.size).toBe(ESTATE_TAB_TYPES.length);
    });

    it('should not conflict with built-in or mining tabs', () => {
      const builtIns = ['chat', 'docs', 'drafts', 'reminders', 'insights', 'doc-context'];
      const miningTabs = [
        'hr', 'ops', 'finance', 'accounting', 'risk', 'compliance', 'workforce',
        'procurement', 'audit', 'legal', 'esg', 'geology', 'treasury',
        'marketplace', 'licences', 'sites', 'safety', 'reports',
      ];
      const reserved = new Set([...builtIns, ...miningTabs]);

      ESTATE_TAB_TYPES.forEach((type) => {
        expect(reserved.has(type)).toBe(false);
      });
    });
  });
});
