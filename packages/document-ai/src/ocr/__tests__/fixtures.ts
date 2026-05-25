/**
 * Reusable test fixtures. Kept minimal so the test suite stays under the
 * 90s ceiling and no real OCR engine is touched.
 */

import type { DocumentPage, TextBlock } from '../../types.js';
import { buildPage } from '../parsed-document-builder.js';

export function leaseAgreementPage(): DocumentPage {
  const blocks: TextBlock[] = [
    {
      id: 'b-0',
      text: 'LEASE AGREEMENT',
      bbox: { x: 0.3, y: 0.02, width: 0.4, height: 0.04 },
      role: 'heading',
      confidence: 0.99,
      language: 'en',
    },
    {
      id: 'b-1',
      text: 'Landlord: Borjie Ltd',
      bbox: { x: 0.1, y: 0.1, width: 0.8, height: 0.04 },
      role: 'paragraph',
      confidence: 0.97,
      language: 'en',
    },
    {
      id: 'b-2',
      text: 'Tenant: Asha Mwangi',
      bbox: { x: 0.1, y: 0.16, width: 0.8, height: 0.04 },
      role: 'paragraph',
      confidence: 0.97,
      language: 'en',
    },
    {
      id: 'b-3',
      text: 'Monthly Rent: TZS 1,250,000',
      bbox: { x: 0.1, y: 0.22, width: 0.8, height: 0.04 },
      role: 'paragraph',
      confidence: 0.95,
      language: 'en',
    },
    {
      id: 'b-4',
      text: 'Term: 12 months starting 2026-06-01',
      bbox: { x: 0.1, y: 0.28, width: 0.8, height: 0.04 },
      role: 'paragraph',
      confidence: 0.95,
      language: 'en',
    },
  ];
  return buildPage({ pageNumber: 1, blocks, language: 'en' });
}

export function swahiliPage(): DocumentPage {
  const blocks: TextBlock[] = [
    {
      id: 'b-0',
      text: 'Mkataba wa Pango wa Nyumba',
      bbox: { x: 0.2, y: 0.05, width: 0.6, height: 0.05 },
      role: 'heading',
      confidence: 0.96,
      language: 'sw',
    },
    {
      id: 'b-1',
      text: 'Mpangaji atalipa kodi ya kila mwezi.',
      bbox: { x: 0.1, y: 0.15, width: 0.8, height: 0.05 },
      role: 'paragraph',
      confidence: 0.93,
      language: 'sw',
    },
  ];
  return buildPage({ pageNumber: 1, blocks, language: 'sw' });
}
