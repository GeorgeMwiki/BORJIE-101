/**
 * JC-9 — 8-country live discovery probes.
 *
 * Verifies the discovery pipeline surfaces real regulator info for the
 * 8 brief-mandated jurisdictions:
 *
 *   Peru / Mongolia / DRC / Ghana / Zambia / Botswana / Argentina /
 *   Kazakhstan.
 *
 * Each probe seeds the web-search adapter with publicly-known
 * regulator names (MINEM Peru, MRAM Mongolia, etc.) and asserts:
 *
 *   - The discovery profile recovers the country code + name.
 *   - The synthesizer extracts at least one named regulator from the
 *     hits (so Mr. Mwikila has a concrete anchor).
 *   - Validity score is at least 0.55 (single-source confidence).
 *   - Source citations make it back to the result with kind='web_search'.
 *
 * These probes are HERMETIC — no real network call. They mirror the
 * shape of the response the brain's web-search tool would return at
 * runtime (the integration with the actual tool is exercised by the
 * brain-tools tests). The point is to prove that GIVEN realistic
 * input, Mr. Mwikila NEVER falls through to "I don't know".
 */

import { describe, expect, it } from 'vitest';

import { createJurisdictionDiscoveryService } from '../service.js';
import type {
  BrainWebSearchAdapter,
  CorpusSearchAdapter,
  DiscoveryCacheAdapter,
} from '../types.js';

// ─── Fake adapters ────────────────────────────────────────────────────

function fakeWeb(
  hits: ReadonlyArray<{ url: string; title: string; snippet: string }>,
): BrainWebSearchAdapter {
  return {
    async search() {
      return hits;
    },
  };
}

function emptyCorpus(): CorpusSearchAdapter {
  return {
    async search() {
      return [];
    },
  };
}

function nullCache(): DiscoveryCacheAdapter {
  return {
    async get() {
      return null;
    },
    async put() {
      // no-op for hermetic probes.
    },
  };
}

// ─── Country probes ───────────────────────────────────────────────────

const PROBES: ReadonlyArray<{
  readonly label: string;
  readonly query: string;
  readonly expectCode: string;
  readonly expectName: string;
  readonly hits: ReadonlyArray<{ url: string; title: string; snippet: string }>;
  /** Regulator substring we expect the synthesizer to surface. */
  readonly expectRegulatorMatch: RegExp;
}> = [
  {
    label: 'Peru',
    query: 'Peru',
    expectCode: 'PE',
    expectName: 'Peru',
    hits: [
      {
        url: 'https://www.gob.pe/minem',
        title:
          'MINEM Peru — Ministry of Energy and Mines mining concessions',
        snippet:
          'The Ministry of Energy and Mines (MINEM) is the Peruvian regulator responsible for mining and energy. Currency PEN.',
      },
      {
        url: 'https://www.ingemmet.gob.pe',
        title: 'INGEMMET — Geological Mining Survey of Peru',
        snippet:
          'INGEMMET maintains the mining cadastre under Mining Law 27343. Languages: spanish, quechua.',
      },
    ],
    expectRegulatorMatch: /MINEM|Mines|INGEMMET|Mining/i,
  },
  {
    label: 'Mongolia',
    query: 'Mongolia',
    expectCode: 'MN',
    expectName: 'Mongolia',
    hits: [
      {
        url: 'https://mram.gov.mn',
        title:
          'MRAM — Mineral Resources and Petroleum Authority of Mongolia',
        snippet:
          'The Mineral Resources and Petroleum Authority of Mongolia is the Mongolian mining regulator. Currency MNT.',
      },
    ],
    expectRegulatorMatch: /Mineral|Resources|Authority|MRAM/i,
  },
  {
    label: 'DRC',
    query: 'DRC',
    expectCode: 'CD',
    expectName: 'Democratic Republic of the Congo',
    hits: [
      {
        url: 'https://mines.gouv.cd',
        title:
          'Ministry of Mines DRC — Code Minier de la République Démocratique',
        snippet:
          'The Ministry of Mines administers mining licences under the Code Minier de la République Démocratique du Congo. Currency CDF.',
      },
      {
        url: 'https://cami.cd',
        title: 'CAMI — Cadastre Minier of the DRC',
        snippet:
          'Cadastre Minier (CAMI) maintains the mining concession registry of the DRC.',
      },
    ],
    expectRegulatorMatch: /Mines|Cadastre|Minier|CAMI/i,
  },
  {
    label: 'Ghana',
    query: 'Ghana',
    expectCode: 'GH',
    expectName: 'Ghana',
    hits: [
      {
        url: 'https://www.mlnr.gov.gh',
        title:
          'Ghana Ministry of Lands and Natural Resources — Minerals Commission',
        snippet:
          'The Minerals Commission of Ghana regulates mining under the Minerals and Mining Act. Currency GHS.',
      },
    ],
    expectRegulatorMatch: /Minerals|Commission|Ministry|Mining/i,
  },
  {
    label: 'Zambia',
    query: 'Zambia',
    expectCode: 'ZM',
    expectName: 'Zambia',
    hits: [
      {
        url: 'https://www.mmmd.gov.zm',
        title:
          'Zambia Ministry of Mines and Minerals Development — Mining Cadastre',
        snippet:
          'The Ministry of Mines and Minerals Development regulates mining licences under the Mines and Minerals Development Act. Currency ZMW.',
      },
    ],
    expectRegulatorMatch: /Mines|Minerals|Ministry|Cadastre/i,
  },
  {
    label: 'Botswana',
    query: 'Botswana',
    expectCode: 'BW',
    expectName: 'Botswana',
    hits: [
      {
        url: 'https://www.gov.bw/ministries/mineral-resources',
        title:
          'Botswana Ministry of Mineral Resources Green Technology and Energy Security',
        snippet:
          'Mining licences in Botswana are issued by the Department of Mines under the Ministry of Mineral Resources. Currency BWP.',
      },
    ],
    expectRegulatorMatch: /Mineral|Mining|Department|Resources|Ministry/i,
  },
  {
    label: 'Argentina',
    query: 'Argentina',
    expectCode: 'AR',
    expectName: 'Argentina',
    hits: [
      {
        url: 'https://www.argentina.gob.ar/produccion/mineria',
        title:
          'Secretaria de Mineria Argentina — Ministerio de Economía',
        snippet:
          'The Secretaria de Mineria regulates mining concessions in Argentina under the Código de Minería. Currency ARS.',
      },
    ],
    expectRegulatorMatch: /Secretaria|Mineria|Mining|Ministerio/i,
  },
  {
    label: 'Kazakhstan',
    query: 'Kazakhstan',
    expectCode: 'KZ',
    expectName: 'Kazakhstan',
    hits: [
      {
        url: 'https://www.gov.kz/memlekettik-organdar/struktura/sentralnyy-apparat/ministry-of-industry-and-infrastructural-development',
        title:
          'Kazakhstan Ministry of Industry and Infrastructural Development — Mining Code',
        snippet:
          'The Committee of Geology under the Ministry of Industry and Infrastructural Development regulates subsoil use in Kazakhstan under the Subsoil Use Code. Currency KZT.',
      },
    ],
    expectRegulatorMatch: /Ministry|Industry|Committee|Geology|Mining/i,
  },
];

// ─── Tests ────────────────────────────────────────────────────────────

describe('JC-9 — 8 live discovery probes (Mr. Mwikila NEVER says I don\'t know)', () => {
  for (const probe of PROBES) {
    it(`surfaces real regulator info for ${probe.label} (${probe.expectCode})`, async () => {
      const svc = createJurisdictionDiscoveryService({
        webSearch: fakeWeb(probe.hits),
        corpus: emptyCorpus(),
        cache: nullCache(),
      });
      const result = await svc.discover(probe.query);

      // Country resolution.
      expect(result.profile.countryCode).toBe(probe.expectCode);
      expect(result.profile.countryName).toBe(probe.expectName);

      // Pipeline ran end-to-end (not the seeded short-circuit).
      expect(result.origin).toBe('discovered');

      // At least one regulator candidate; one should match the
      // expected substring.
      expect(result.profile.regulators.length).toBeGreaterThan(0);
      const haystack = result.profile.regulators
        .map((r) => r.name)
        .join(' ');
      expect(haystack).toMatch(probe.expectRegulatorMatch);

      // Single-source minimum confidence (web only).
      expect(result.profile.validityScore).toBeGreaterThanOrEqual(0.55);
      expect(result.lowConfidence).toBe(false);

      // Sources travelled through with the right kind.
      expect(result.sources.length).toBeGreaterThan(0);
      expect(
        result.sources.some((s) => s.kind === 'web_search'),
      ).toBe(true);
    });
  }
});
