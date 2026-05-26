import { describe, expect, it } from 'vitest';
import { validateProposal } from '../decisions/proposal-validator.js';
import type { ProposedDiff } from '../types.js';
import type { FormSchema } from '@borjie/dynamic-ui';

const SCHEMA: FormSchema = {
  title_en: 'Buyer KYB Start',
  title_sw: 'Mwanzo wa KYB ya Mnunuzi',
  groups: [
    {
      id: 'identity',
      title_en: 'Identity',
      title_sw: 'Utambulisho',
      fields: [
        {
          id: 'tin_number',
          kind: 'text',
          label_en: 'TIN',
          label_sw: 'Nambari ya TIN',
          required: true,
        },
        {
          id: 'company_name',
          kind: 'text',
          label_en: 'Company',
          label_sw: 'Kampuni',
          required: true,
        },
      ],
    },
    {
      id: 'compliance',
      title_en: 'Compliance',
      title_sw: 'Utiifu',
      fields: [
        {
          id: 'ofac_check',
          kind: 'enum',
          label_en: 'OFAC Check',
          label_sw: 'Ukaguzi wa OFAC',
          required: true,
        },
      ],
    },
  ],
  submit_action: {
    form_id: 'buyer_kyb',
    url: '/api/gateway/forms/buyer_kyb',
    method: 'POST',
  },
  evidence_ids: ['TUMEMADINI-4.2'],
};

describe('validateProposal', () => {
  it('rejects empty diff', () => {
    const diff: ProposedDiff = {
      ops: [],
      rationaleEn: 'placeholder long enough',
      rationaleSw: 'placeholder long enough',
    };
    const r = validateProposal({
      currentSchema: SCHEMA,
      diff,
      knownCitations: ['TUMEMADINI-4.2'],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.violations.some((v) => v.includes('zero ops'))).toBe(true);
    }
  });

  it('accepts a valid add_help_copy with a known citation', () => {
    const diff: ProposedDiff = {
      ops: [
        {
          op: 'add_help_copy',
          fieldId: 'tin_number',
          helpEn: 'Enter the 11-digit TIN.',
          helpSw: 'Andika TIN ya tarakimu 11.',
          citationId: 'TUMEMADINI-4.2',
        },
      ],
      rationaleEn: 'Operators struggle with TIN format.',
      rationaleSw: 'Watumiaji wana shida na muundo wa TIN.',
    };
    const r = validateProposal({
      currentSchema: SCHEMA,
      diff,
      knownCitations: ['TUMEMADINI-4.2'],
    });
    expect(r.ok).toBe(true);
  });

  it('rejects add_help_copy that cites an unknown citation_id', () => {
    const diff: ProposedDiff = {
      ops: [
        {
          op: 'add_help_copy',
          fieldId: 'tin_number',
          helpEn: 'Tip.',
          helpSw: 'Kidokezo.',
          citationId: 'UNKNOWN-CITATION',
        },
      ],
      rationaleEn: 'Helpful copy.',
      rationaleSw: 'Maelezo ya manufaa.',
    };
    const r = validateProposal({
      currentSchema: SCHEMA,
      diff,
      knownCitations: ['TUMEMADINI-4.2'],
    });
    expect(r.ok).toBe(false);
  });

  it('rejects reorder when before/after lengths differ', () => {
    const diff: ProposedDiff = {
      ops: [
        {
          op: 'reorder_fields',
          groupId: 'identity',
          fieldIdsBefore: ['tin_number', 'company_name'],
          fieldIdsAfter: ['company_name'],
        },
      ],
      rationaleEn: 'Reorder fields.',
      rationaleSw: 'Panga upya nyanja.',
    };
    const r = validateProposal({
      currentSchema: SCHEMA,
      diff,
      knownCitations: [],
    });
    expect(r.ok).toBe(false);
  });

  it('rejects regroup_field when fromGroupId is wrong', () => {
    const diff: ProposedDiff = {
      ops: [
        {
          op: 'regroup_field',
          fieldId: 'tin_number',
          fromGroupId: 'compliance', // actually in `identity`
          toGroupId: 'compliance',
        },
      ],
      rationaleEn: 'Move it.',
      rationaleSw: 'Hamisha hii.',
    };
    const r = validateProposal({
      currentSchema: SCHEMA,
      diff,
      knownCitations: [],
    });
    expect(r.ok).toBe(false);
  });

  it('rejects split_step with fewer than 2 destination groups', () => {
    const diff: ProposedDiff = {
      ops: [
        {
          op: 'split_step',
          groupId: 'identity',
          intoGroupIds: ['identity'],
        },
      ],
      rationaleEn: 'Split.',
      rationaleSw: 'Gawanya.',
    };
    const r = validateProposal({
      currentSchema: SCHEMA,
      diff,
      knownCitations: [],
    });
    expect(r.ok).toBe(false);
  });

  it('rejects rename_label when before/after identical', () => {
    const diff: ProposedDiff = {
      ops: [
        {
          op: 'rename_label',
          fieldId: 'tin_number',
          labelEnBefore: 'TIN',
          labelEnAfter: 'TIN',
          labelSwBefore: 'TIN',
          labelSwAfter: 'TIN',
        },
      ],
      rationaleEn: 'Clarify TIN.',
      rationaleSw: 'Fafanua TIN.',
    };
    const r = validateProposal({
      currentSchema: SCHEMA,
      diff,
      knownCitations: [],
    });
    expect(r.ok).toBe(false);
  });

  it('rejects brand-token violations in help copy', () => {
    const diff: ProposedDiff = {
      ops: [
        {
          op: 'add_help_copy',
          fieldId: 'tin_number',
          helpEn: 'Use color #ff00aa for emphasis.', // raw hex
          helpSw: 'Kawaida.',
          citationId: 'TUMEMADINI-4.2',
        },
      ],
      rationaleEn: 'Highlight TIN.',
      rationaleSw: 'Onyesha TIN.',
    };
    const r = validateProposal({
      currentSchema: SCHEMA,
      diff,
      knownCitations: ['TUMEMADINI-4.2'],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.violations.some((v) => v.includes('Brand-token'))).toBe(true);
    }
  });

  it('rejects inline style in rename_label', () => {
    const diff: ProposedDiff = {
      ops: [
        {
          op: 'rename_label',
          fieldId: 'tin_number',
          labelEnBefore: 'TIN',
          labelEnAfter: 'TIN <span style="color:red">!</span>',
          labelSwBefore: 'TIN',
          labelSwAfter: 'TIN!',
        },
      ],
      rationaleEn: 'Highlight.',
      rationaleSw: 'Onyesha.',
    };
    const r = validateProposal({
      currentSchema: SCHEMA,
      diff,
      knownCitations: [],
    });
    expect(r.ok).toBe(false);
  });

  it('rejects rationales that are missing or too short', () => {
    const diff: ProposedDiff = {
      ops: [
        {
          op: 'rename_label',
          fieldId: 'tin_number',
          labelEnBefore: 'TIN',
          labelEnAfter: 'Tax Identification Number',
          labelSwBefore: 'TIN',
          labelSwAfter: 'Nambari ya Utambulisho wa Kodi',
        },
      ],
      rationaleEn: '',
      rationaleSw: '',
    };
    const r = validateProposal({
      currentSchema: SCHEMA,
      diff,
      knownCitations: [],
    });
    expect(r.ok).toBe(false);
  });
});
