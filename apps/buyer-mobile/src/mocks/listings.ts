import type { Listing } from '@/types/listing'

// Realistic Tanzanian mineral parcels for marketplace stubs.
// Prices in TZS/kg are illustrative; assay PDFs and photos are placeholders
// that resolve in dev via picsum.photos / example.com.

export const mockListings: readonly Listing[] = [
  {
    id: 'lst-001',
    mineral: 'gold_concentrate',
    title: 'Gold concentrate · Geita Greenstone',
    grade: '42 g/t Au',
    quantityKg: 18,
    originSite: 'Nyamulilima PML 4421',
    originRegion: 'Geita',
    seller: {
      id: 'sel-100',
      name: 'Nyamulilima Cooperative',
      pmlNumber: 'PML-4421',
      rating: 4.6,
      verified: true
    },
    priceTzsPerKg: 32_500_000,
    priceHintTzs: 585_000_000,
    photos: [
      'https://picsum.photos/seed/geita-gold-1/800/600',
      'https://picsum.photos/seed/geita-gold-2/800/600'
    ],
    assayPdfUrl: 'https://example.com/assay/lst-001.pdf',
    assayResults: [
      { element: 'Au', grade: '42.1 g/t', method: 'fire assay' },
      { element: 'Ag', grade: '6.3 g/t', method: 'AAS' }
    ],
    chainOfCustody: [
      'Sampled by SGS Mwanza · 2026-05-02',
      'Sealed at Nyamulilima · bag SB-2206',
      'District weighbridge · ticket 88123'
    ],
    listedAt: '2026-05-18T07:12:00Z',
    status: 'open'
  },
  {
    id: 'lst-002',
    mineral: 'tanzanite_rough',
    title: 'Tanzanite rough · Mererani Block C',
    grade: 'AAA · vivid blue',
    quantityKg: 0.85,
    originSite: 'Block C shaft 17',
    originRegion: 'Manyara · Mererani',
    seller: {
      id: 'sel-101',
      name: 'Mererani Miners Group',
      pmlNumber: 'PML-2207',
      rating: 4.9,
      verified: true
    },
    priceTzsPerKg: 5_400_000_000,
    priceHintTzs: 4_590_000_000,
    photos: [
      'https://picsum.photos/seed/tanzanite-1/800/600',
      'https://picsum.photos/seed/tanzanite-2/800/600'
    ],
    assayPdfUrl: 'https://example.com/assay/lst-002.pdf',
    assayResults: [
      { element: 'colour', grade: 'vB 6/5', method: 'GIA scale' },
      { element: 'clarity', grade: 'VVS', method: 'loupe 10x' }
    ],
    chainOfCustody: [
      'Mined Block C · 2026-04-29',
      'TanzaniteOne sort · lot TZ-99',
      'Arusha vault deposit · seal 4412'
    ],
    listedAt: '2026-05-20T15:45:00Z',
    status: 'open'
  },
  {
    id: 'lst-003',
    mineral: 'coltan',
    title: 'Coltan · Kahama tantalite',
    grade: '32% Ta2O5',
    quantityKg: 1_200,
    originSite: 'Kahama PML 7780',
    originRegion: 'Shinyanga · Kahama',
    seller: {
      id: 'sel-102',
      name: 'Kahama Resources Ltd',
      pmlNumber: 'PML-7780',
      rating: 4.2,
      verified: true
    },
    priceTzsPerKg: 410_000,
    priceHintTzs: 492_000_000,
    photos: ['https://picsum.photos/seed/coltan-1/800/600'],
    assayPdfUrl: 'https://example.com/assay/lst-003.pdf',
    assayResults: [
      { element: 'Ta2O5', grade: '32.4%', method: 'XRF' },
      { element: 'Nb2O5', grade: '18.1%', method: 'XRF' }
    ],
    chainOfCustody: [
      'Mined Q1 2026',
      'ITSCI tag · KH-22-908',
      'Mwanza dry-port consolidation'
    ],
    listedAt: '2026-05-17T09:00:00Z',
    status: 'open'
  },
  {
    id: 'lst-004',
    mineral: 'copper_concentrate',
    title: 'Copper concentrate · Mbeya',
    grade: '24% Cu',
    quantityKg: 28_000,
    originSite: 'Mbozi PML 6610',
    originRegion: 'Mbeya · Mbozi',
    seller: {
      id: 'sel-103',
      name: 'Mbozi Mining Cooperative',
      pmlNumber: 'PML-6610',
      rating: 4.1,
      verified: true
    },
    priceTzsPerKg: 22_500,
    priceHintTzs: 630_000_000,
    photos: ['https://picsum.photos/seed/copper-1/800/600'],
    assayPdfUrl: 'https://example.com/assay/lst-004.pdf',
    assayResults: [
      { element: 'Cu', grade: '24.2%', method: 'ICP-OES' },
      { element: 'Au', grade: '1.4 g/t', method: 'fire assay' }
    ],
    chainOfCustody: [
      'Beneficiated at Mbozi mill',
      'Weighbridge Mbeya · ticket 7102',
      'TRC railhead Mbeya'
    ],
    listedAt: '2026-05-15T11:30:00Z',
    status: 'open'
  },
  {
    id: 'lst-005',
    mineral: 'gemstone_mixed',
    title: 'Mixed gemstones · Tunduru',
    grade: 'commercial · facet grade 30%',
    quantityKg: 12,
    originSite: 'Tunduru PML 3318',
    originRegion: 'Ruvuma · Tunduru',
    seller: {
      id: 'sel-104',
      name: 'Tunduru Gem Traders',
      pmlNumber: 'PML-3318',
      rating: 4.4,
      verified: false
    },
    priceTzsPerKg: 18_000_000,
    priceHintTzs: 216_000_000,
    photos: [
      'https://picsum.photos/seed/gem-1/800/600',
      'https://picsum.photos/seed/gem-2/800/600'
    ],
    assayPdfUrl: 'https://example.com/assay/lst-005.pdf',
    assayResults: [
      { element: 'sapphire', grade: '54%', method: 'visual sort' },
      { element: 'ruby', grade: '12%', method: 'visual sort' },
      { element: 'spinel', grade: '34%', method: 'visual sort' }
    ],
    chainOfCustody: [
      'Sorted at Tunduru centre · 2026-05-10',
      'Lot TND-114 sealed'
    ],
    listedAt: '2026-05-12T08:00:00Z',
    status: 'open'
  },
  {
    id: 'lst-006',
    mineral: 'gold_dore',
    title: 'Gold doré bars · Chunya',
    grade: '88% Au · 6% Ag',
    quantityKg: 6.4,
    originSite: 'Chunya PML 9912',
    originRegion: 'Mbeya · Chunya',
    seller: {
      id: 'sel-105',
      name: 'Chunya Gold Refinery',
      pmlNumber: 'PML-9912',
      rating: 4.8,
      verified: true
    },
    priceTzsPerKg: 268_000_000,
    priceHintTzs: 1_715_200_000,
    photos: ['https://picsum.photos/seed/dore-1/800/600'],
    assayPdfUrl: 'https://example.com/assay/lst-006.pdf',
    assayResults: [
      { element: 'Au', grade: '88.2%', method: 'fire assay' },
      { element: 'Ag', grade: '6.1%', method: 'fire assay' }
    ],
    chainOfCustody: [
      'Refined Chunya · 2026-05-19',
      'BoT serial CH-DORE-04412'
    ],
    listedAt: '2026-05-22T06:20:00Z',
    status: 'open'
  },
  {
    id: 'lst-007',
    mineral: 'tin_cassiterite',
    title: 'Cassiterite · Kyerwa',
    grade: '68% Sn',
    quantityKg: 4_500,
    originSite: 'Kyerwa PML 5501',
    originRegion: 'Kagera · Kyerwa',
    seller: {
      id: 'sel-106',
      name: 'Kyerwa Tin Cooperative',
      pmlNumber: 'PML-5501',
      rating: 4.0,
      verified: true
    },
    priceTzsPerKg: 78_000,
    priceHintTzs: 351_000_000,
    photos: ['https://picsum.photos/seed/tin-1/800/600'],
    assayPdfUrl: 'https://example.com/assay/lst-007.pdf',
    assayResults: [
      { element: 'Sn', grade: '68.4%', method: 'XRF' }
    ],
    chainOfCustody: [
      'Mined Kyerwa Q2 2026',
      'ITSCI tag KY-22-1188'
    ],
    listedAt: '2026-05-14T13:10:00Z',
    status: 'reserved'
  },
  {
    id: 'lst-008',
    mineral: 'silver_concentrate',
    title: 'Silver concentrate · Lupa',
    grade: '1_240 g/t Ag',
    quantityKg: 9_200,
    originSite: 'Lupa PML 8845',
    originRegion: 'Mbeya · Lupa',
    seller: {
      id: 'sel-107',
      name: 'Lupa Silver Partners',
      pmlNumber: 'PML-8845',
      rating: 4.3,
      verified: true
    },
    priceTzsPerKg: 19_500,
    priceHintTzs: 179_400_000,
    photos: ['https://picsum.photos/seed/silver-1/800/600'],
    assayPdfUrl: 'https://example.com/assay/lst-008.pdf',
    assayResults: [
      { element: 'Ag', grade: '1245 g/t', method: 'fire assay' },
      { element: 'Pb', grade: '4.1%', method: 'ICP-OES' }
    ],
    chainOfCustody: [
      'Processed at Lupa mill',
      'Weighbridge Mbeya · ticket 8806'
    ],
    listedAt: '2026-05-21T17:00:00Z',
    status: 'open'
  }
] as const

export function findListing(id: string): Listing | undefined {
  return mockListings.find((listing) => listing.id === id)
}
