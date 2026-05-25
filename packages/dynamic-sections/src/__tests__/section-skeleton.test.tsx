/**
 * `<SectionSkeleton>` smoke tests — verifies the a11y attributes the
 * portal designers rely on for screen-reader announcements.
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SectionSkeleton } from '../components/SectionSkeleton.js';

describe('<SectionSkeleton>', () => {
  it('renders with the expected testid + role=status', () => {
    render(<SectionSkeleton />);
    const root = screen.getByTestId('dynamic-section-skeleton');
    expect(root).toBeInTheDocument();
    expect(root.getAttribute('role')).toBe('status');
  });

  it('includes a screen-reader-only label when sectionLabel is passed', () => {
    render(<SectionSkeleton sectionLabel="Customers" />);
    expect(screen.getByText(/Loading Customers section/i)).toBeInTheDocument();
  });

  it('uses a generic label when no sectionLabel is passed', () => {
    render(<SectionSkeleton />);
    expect(screen.getByText(/Loading section content/i)).toBeInTheDocument();
  });

  it('accepts a className override', () => {
    render(<SectionSkeleton className="my-custom-class" />);
    const root = screen.getByTestId('dynamic-section-skeleton');
    expect(root.className).toContain('my-custom-class');
  });
});
