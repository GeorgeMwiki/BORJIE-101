import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { axe } from './setup';

import { SearchBar, applyFilter } from '../components/SearchBar';
import { EMPTY_FILTER } from '../types';
import { makeSmallPosts } from './fixtures';

describe('SearchBar', () => {
  it('emits an onChange when the query input changes', () => {
    const onChange = vi.fn();
    render(<SearchBar posts={makeSmallPosts()} filter={EMPTY_FILTER} onChange={onChange} />);
    fireEvent.change(screen.getByTestId('search-bar-input'), { target: { value: 'pit' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[0].query).toBe('pit');
  });

  it('filters posts by query, KS, region, and date range', () => {
    const posts = makeSmallPosts();
    const byQ = applyFilter(posts, { ...EMPTY_FILTER, query: 'haul' });
    expect(byQ.map((p) => p.id)).toEqual(['p2', 'p3']);
    const byKs = applyFilter(posts, {
      ...EMPTY_FILTER,
      knowledgeStates: new Set(['error']),
    });
    expect(byKs.map((p) => p.id)).toEqual(['p4']);
    const byRegion = applyFilter(posts, {
      ...EMPTY_FILTER,
      regions: new Set(['leach-tank-3']),
    });
    expect(byRegion.map((p) => p.id)).toEqual(['p4']);
    const byDate = applyFilter(posts, {
      ...EMPTY_FILTER,
      startDate: '2026-05-27',
      endDate: '2026-05-27',
    });
    expect(byDate.map((p) => p.id)).toEqual(['p4']);
  });

  it('has no axe violations', async () => {
    const onChange = vi.fn();
    const { container } = render(
      <SearchBar posts={makeSmallPosts()} filter={EMPTY_FILTER} onChange={onChange} />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
