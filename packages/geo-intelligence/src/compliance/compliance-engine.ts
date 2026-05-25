/**
 * Compliance engine — dispatches zoning / flood / title queries to the
 * per-jurisdiction adapter.
 */

import type {
  FloodRiskOverlay,
  GeoJsonPoint,
  Jurisdiction,
  LegalTitleOverlay,
  ParcelId,
  ZoningOverlay,
} from '../types.js';
import * as TZ from './jurisdictions/tz.js';
import * as KE from './jurisdictions/ke.js';
import * as UG from './jurisdictions/ug.js';
import * as RW from './jurisdictions/rw.js';

export interface ComplianceEngine {
  readonly zoningOverlay: (args: {
    readonly parcelId: ParcelId;
    readonly centroid: GeoJsonPoint;
    readonly jurisdiction: Jurisdiction;
  }) => ZoningOverlay;
  readonly floodRiskOverlay: (args: {
    readonly parcelId: ParcelId;
    readonly centroid: GeoJsonPoint;
    readonly jurisdiction: Jurisdiction;
  }) => FloodRiskOverlay;
  readonly legalTitleOverlay: (args: {
    readonly parcelId: ParcelId;
    readonly jurisdiction: Jurisdiction;
  }) => LegalTitleOverlay;
}

export function createComplianceEngine(): ComplianceEngine {
  return Object.freeze({
    zoningOverlay(args: {
      readonly parcelId: ParcelId;
      readonly centroid: GeoJsonPoint;
      readonly jurisdiction: Jurisdiction;
    }): ZoningOverlay {
      const { parcelId, centroid, jurisdiction } = args;
      const now = new Date().toISOString();
      switch (jurisdiction) {
        case 'TZ':
          return Object.freeze({
            jurisdiction,
            parcelId,
            zoningClass: TZ.classifyTzZoning(centroid),
            authority: TZ.TZ_AUTHORITY,
            evaluatedAt: now,
          });
        case 'KE':
          return Object.freeze({
            jurisdiction,
            parcelId,
            zoningClass: KE.classifyKeZoning(centroid),
            authority: KE.KE_AUTHORITY,
            evaluatedAt: now,
          });
        case 'UG':
          return Object.freeze({
            jurisdiction,
            parcelId,
            zoningClass: UG.classifyUgZoning(centroid),
            authority: UG.UG_AUTHORITY,
            evaluatedAt: now,
          });
        case 'RW':
          return Object.freeze({
            jurisdiction,
            parcelId,
            zoningClass: RW.classifyRwZoning(centroid),
            authority: RW.RW_AUTHORITY,
            evaluatedAt: now,
          });
        default:
          throw new Error(`Unsupported jurisdiction: ${String(jurisdiction)}`);
      }
    },
    floodRiskOverlay(args: {
      readonly parcelId: ParcelId;
      readonly centroid: GeoJsonPoint;
      readonly jurisdiction: Jurisdiction;
    }): FloodRiskOverlay {
      const { parcelId, centroid, jurisdiction } = args;
      const band = (() => {
        switch (jurisdiction) {
          case 'TZ':
            return TZ.tzFloodRisk(centroid);
          case 'KE':
            return KE.keFloodRisk(centroid);
          case 'UG':
            return UG.ugFloodRisk(centroid);
          case 'RW':
            return RW.rwFloodRisk(centroid);
          default:
            throw new Error(`Unsupported jurisdiction: ${String(jurisdiction)}`);
        }
      })();
      return Object.freeze({
        parcelId,
        band,
        source: `${jurisdiction}-flood-overlay-v0`,
      });
    },
    legalTitleOverlay(args: {
      readonly parcelId: ParcelId;
      readonly jurisdiction: Jurisdiction;
    }): LegalTitleOverlay {
      const { parcelId, jurisdiction } = args;
      const status = (() => {
        switch (jurisdiction) {
          case 'TZ':
            return TZ.tzLegalTitleStatus(parcelId);
          case 'KE':
            return KE.keLegalTitleStatus(parcelId);
          case 'UG':
            return UG.ugLegalTitleStatus(parcelId);
          case 'RW':
            return RW.rwLegalTitleStatus(parcelId);
          default:
            throw new Error(`Unsupported jurisdiction: ${String(jurisdiction)}`);
        }
      })();
      return Object.freeze({
        parcelId,
        status,
        jurisdiction,
      });
    },
  });
}
