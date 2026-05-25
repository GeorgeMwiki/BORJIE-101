/**
 * Entity-mapping proposal tests. Covers:
 *   - heuristic mapper picks the right entity_type for each fixture
 *   - confidence calibration around AUTO_MAP / LLM_PROPOSAL thresholds
 *   - routing decisions
 *   - Zod schema enforcement on LLM output
 *   - LLM hallucination defence
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseCsv } from '../schema-sniff/csv-adapter.js';
import { inferSchema } from '../schema-sniff/infer.js';
import { proposeMappingHeuristic } from '../proposal/heuristic-map.js';
import {
  AUTO_MAP_THRESHOLD,
  LLM_PROPOSAL_THRESHOLD,
  routeByConfidence,
} from '../proposal/thresholds.js';
import {
  entityMappingProposalSchema,
  type EntityMappingProposal,
} from '../proposal/types.js';
import {
  proposeMappingViaLlm,
  LlmProposalValidationError,
} from '../proposal/llm-proposer.js';
import { InMemoryEntityStoreService } from '../entity-store/InMemoryEntityStoreService.js';

const FIXTURES = join(__dirname, '..', '..', '__fixtures__');
const read = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');

async function entityTypes() {
  const store = new InMemoryEntityStoreService();
  return store.listEntityTypes('tenant-1');
}

describe('heuristic proposal', () => {
  it('maps hr-roster.csv to employee with high confidence', async () => {
    const types = await entityTypes();
    const schema = inferSchema(parseCsv(read('hr-roster.csv')));
    const proposal = proposeMappingHeuristic({
      schema,
      availableEntityTypes: types,
    });
    expect(proposal.entity_type).toEqual('employee');
    expect(proposal.field_map['full_name']).toEqual('full_name');
    expect(proposal.field_map['email']).toEqual('email');
    expect(proposal.confidence).toBeGreaterThanOrEqual(AUTO_MAP_THRESHOLD);
  });

  it('maps property-portfolio.csv to property', async () => {
    const types = await entityTypes();
    const schema = inferSchema(parseCsv(read('property-portfolio.csv')));
    const proposal = proposeMappingHeuristic({
      schema,
      availableEntityTypes: types,
    });
    expect(proposal.entity_type).toEqual('property');
    expect(proposal.field_map['reference']).toEqual('reference');
    expect(proposal.confidence).toBeGreaterThan(LLM_PROPOSAL_THRESHOLD);
  });

  it('maps sales-leads.csv to lead', async () => {
    const types = await entityTypes();
    const schema = inferSchema(parseCsv(read('sales-leads.csv')));
    const proposal = proposeMappingHeuristic({
      schema,
      availableEntityTypes: types,
    });
    expect(proposal.entity_type).toEqual('lead');
    expect(proposal.field_map['email']).toEqual('email');
  });

  it('maps kra-filings.csv to kra_filing', async () => {
    const types = await entityTypes();
    const schema = inferSchema(parseCsv(read('kra-filings.csv')));
    const proposal = proposeMappingHeuristic({
      schema,
      availableEntityTypes: types,
    });
    expect(proposal.entity_type).toEqual('kra_filing');
  });

  it('maps vendor-list.csv to vendor', async () => {
    const types = await entityTypes();
    const schema = inferSchema(parseCsv(read('vendor-list.csv')));
    const proposal = proposeMappingHeuristic({
      schema,
      availableEntityTypes: types,
    });
    expect(proposal.entity_type).toEqual('vendor');
  });

  it('maps tenant-payments.csv to tenant_payment', async () => {
    const types = await entityTypes();
    const schema = inferSchema(parseCsv(read('tenant-payments.csv')));
    const proposal = proposeMappingHeuristic({
      schema,
      availableEntityTypes: types,
    });
    expect(proposal.entity_type).toEqual('tenant_payment');
  });

  it('maps employee-performance.csv to employee_performance', async () => {
    const types = await entityTypes();
    const schema = inferSchema(parseCsv(read('employee-performance.csv')));
    const proposal = proposeMappingHeuristic({
      schema,
      availableEntityTypes: types,
    });
    expect(proposal.entity_type).toEqual('employee_performance');
  });

  it('produces "unknown" entity_type when no columns match', async () => {
    const types = await entityTypes();
    const schema = inferSchema(
      parseCsv('foo,bar,baz\nx,y,z\nq,r,s\n')
    );
    const proposal = proposeMappingHeuristic({
      schema,
      availableEntityTypes: types,
    });
    expect(proposal.entity_type).toEqual('unknown');
    expect(proposal.confidence).toEqual(0);
    expect(proposal.conflicts.length).toBeGreaterThan(0);
  });
});

describe('confidence routing thresholds', () => {
  it('auto-maps when confidence >= AUTO_MAP_THRESHOLD', () => {
    expect(routeByConfidence(AUTO_MAP_THRESHOLD)).toEqual('auto-map');
    expect(routeByConfidence(0.99)).toEqual('auto-map');
  });

  it('requests LLM proposal between LLM_PROPOSAL_THRESHOLD and AUTO_MAP_THRESHOLD', () => {
    expect(routeByConfidence(LLM_PROPOSAL_THRESHOLD)).toEqual('llm-proposal');
    expect(routeByConfidence((AUTO_MAP_THRESHOLD + LLM_PROPOSAL_THRESHOLD) / 2)).toEqual(
      'llm-proposal'
    );
    expect(routeByConfidence(AUTO_MAP_THRESHOLD - 0.001)).toEqual('llm-proposal');
  });

  it('flags manual review when confidence < LLM_PROPOSAL_THRESHOLD', () => {
    expect(routeByConfidence(LLM_PROPOSAL_THRESHOLD - 0.001)).toEqual('manual-review');
    expect(routeByConfidence(0)).toEqual('manual-review');
  });
});

describe('Zod schema validation', () => {
  it('accepts a well-formed proposal', () => {
    const valid: EntityMappingProposal = {
      entity_type: 'employee',
      field_map: { full_name: 'full_name', email: 'email' },
      confidence: 0.9,
      llm_rationale: 'looks like an HR roster',
      conflicts: [],
    };
    expect(() => entityMappingProposalSchema.parse(valid)).not.toThrow();
  });

  it('rejects out-of-range confidence', () => {
    expect(() =>
      entityMappingProposalSchema.parse({
        entity_type: 'employee',
        field_map: {},
        confidence: 1.5,
        llm_rationale: '',
        conflicts: [],
      })
    ).toThrow();
  });

  it('rejects missing fields', () => {
    expect(() =>
      entityMappingProposalSchema.parse({
        entity_type: 'employee',
        field_map: {},
        confidence: 0.5,
      })
    ).toThrow();
  });

  it('rejects unknown severity in a conflict', () => {
    expect(() =>
      entityMappingProposalSchema.parse({
        entity_type: 'employee',
        field_map: {},
        confidence: 0.5,
        llm_rationale: '',
        conflicts: [{ column: 'x', reason: 'r', severity: 'critical' }],
      })
    ).toThrow();
  });
});

describe('LLM proposer adapter', () => {
  it('passes through valid LLM JSON output', async () => {
    const types = await entityTypes();
    const schema = inferSchema(parseCsv(read('hr-roster.csv')));
    const heuristicProposal = proposeMappingHeuristic({
      schema,
      availableEntityTypes: types,
    });

    const proposer = async () =>
      JSON.stringify({
        entity_type: 'employee',
        field_map: { full_name: 'full_name', email: 'email', phone: 'phone' },
        confidence: 0.87,
        llm_rationale: 'Looks like an employee roster',
        conflicts: [],
      } satisfies EntityMappingProposal);

    const result = await proposeMappingViaLlm(
      { schema, availableEntityTypes: types, heuristicProposal },
      proposer
    );
    expect(result.entity_type).toEqual('employee');
  });

  it('rejects malformed JSON', async () => {
    const types = await entityTypes();
    const schema = inferSchema(parseCsv(read('hr-roster.csv')));
    const heuristicProposal = proposeMappingHeuristic({
      schema,
      availableEntityTypes: types,
    });
    await expect(
      proposeMappingViaLlm(
        { schema, availableEntityTypes: types, heuristicProposal },
        async () => 'not json'
      )
    ).rejects.toBeInstanceOf(LlmProposalValidationError);
  });

  it('rejects hallucinated entity_type', async () => {
    const types = await entityTypes();
    const schema = inferSchema(parseCsv(read('hr-roster.csv')));
    const heuristicProposal = proposeMappingHeuristic({
      schema,
      availableEntityTypes: types,
    });
    const proposer = async () =>
      JSON.stringify({
        entity_type: 'made_up_type',
        field_map: {},
        confidence: 0.9,
        llm_rationale: '',
        conflicts: [],
      });
    await expect(
      proposeMappingViaLlm(
        { schema, availableEntityTypes: types, heuristicProposal },
        proposer
      )
    ).rejects.toBeInstanceOf(LlmProposalValidationError);
  });

  it('rejects field_map referencing unknown columns', async () => {
    const types = await entityTypes();
    const schema = inferSchema(parseCsv(read('hr-roster.csv')));
    const heuristicProposal = proposeMappingHeuristic({
      schema,
      availableEntityTypes: types,
    });
    const proposer = async () =>
      JSON.stringify({
        entity_type: 'employee',
        field_map: { does_not_exist: 'full_name' },
        confidence: 0.9,
        llm_rationale: '',
        conflicts: [],
      });
    await expect(
      proposeMappingViaLlm(
        { schema, availableEntityTypes: types, heuristicProposal },
        proposer
      )
    ).rejects.toBeInstanceOf(LlmProposalValidationError);
  });
});
