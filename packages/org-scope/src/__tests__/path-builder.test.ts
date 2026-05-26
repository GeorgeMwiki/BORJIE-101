import { describe, expect, it } from 'vitest';
import {
  buildChildPath,
  buildTenantRootPath,
  isDescendantPath,
  slugify,
} from '../hierarchy/path-builder.js';

describe('path-builder', () => {
  describe('slugify', () => {
    it('lowercases + dashes non-alphanumerics', () => {
      expect(slugify('Geita Mining Co.')).toBe('geita-mining-co');
    });

    it('returns "_" for empty input', () => {
      expect(slugify('')).toBe('_');
    });

    it('returns "_" for all-punctuation input', () => {
      expect(slugify('!!!')).toBe('_');
    });

    it('trims trailing dashes', () => {
      expect(slugify('hello!')).toBe('hello');
    });
  });

  describe('buildChildPath', () => {
    it('builds top-level path from tenant slug', () => {
      expect(buildChildPath('borjie-tz', null, 'North Zone')).toBe('borjie-tz/north-zone');
    });

    it('appends to parent path', () => {
      expect(buildChildPath('borjie-tz', 'borjie-tz/north-zone', 'Geita')).toBe(
        'borjie-tz/north-zone/geita',
      );
    });
  });

  describe('buildTenantRootPath', () => {
    it('returns slugged tenant id', () => {
      expect(buildTenantRootPath('Borjie TZ')).toBe('borjie-tz');
    });
  });

  describe('isDescendantPath', () => {
    it('matches exact', () => {
      expect(isDescendantPath('borjie/geita', 'borjie/geita')).toBe(true);
    });

    it('matches descendant', () => {
      expect(isDescendantPath('borjie/geita/site-a', 'borjie/geita')).toBe(true);
    });

    it('rejects sibling with prefix overlap', () => {
      expect(isDescendantPath('borjie/geita-2', 'borjie/geita')).toBe(false);
    });

    it('rejects unrelated paths', () => {
      expect(isDescendantPath('borjie/mererani', 'borjie/geita')).toBe(false);
    });
  });
});
