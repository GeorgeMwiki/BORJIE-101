/**
 * Storybook deck — every Borjie mining-domain seed section in three
 * states:
 *   - Empty (no data; section is hidden from a real DynamicTabBar)
 *   - Loading (skeleton fallback)
 *   - Populated (the stub component rendered)
 *
 * Each section gets its own story rather than a parameterised one so
 * the design QA pass can flip through them quickly + reviewers can
 * link to a specific section's story in PR comments.
 */

import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  PmlLicencesSection,
  RoyaltyDraftsSection,
  ActiveShiftsSection,
  OreParcelsSection,
  NemcFilingsSection,
  GeologyLogsSection,
  ComplianceDeadlinesSection,
  CooperativeMembershipSection,
} from '../seed/section-components.js';
import { SectionSkeleton } from '../components/SectionSkeleton.js';

type Story = StoryObj;

const meta: Meta = {
  title: 'DynamicSections/Mining Seed Sections',
  tags: ['autodocs'],
};
export default meta;

const baseProps = {
  tenantId: 'demo-tenant-tz-01',
  orgId: 'demo-org-tabora',
  scope: 'owner-customer' as const,
};

/* ---------------- PML Licences ---------------- */

export const PmlLicencesEmpty: Story = {
  name: 'PML Licences · Empty',
  render: () => (
    <div className="rounded-lg border border-slate-200 p-6 text-sm text-slate-500">
      The PML Licences tab is hidden when the tenant has no registered
      Primary Mining Licences. This story documents the implicit empty
      state — the section is simply not rendered.
    </div>
  ),
};

export const PmlLicencesLoading: Story = {
  name: 'PML Licences · Loading',
  render: () => <SectionSkeleton sectionLabel="PML Licences" />,
};

export const PmlLicencesPopulated: Story = {
  name: 'PML Licences · Populated',
  render: () => (
    <PmlLicencesSection {...baseProps} entityType="pml-licences" />
  ),
};

/* ---------------- Royalty Drafts ---------------- */

export const RoyaltyDraftsEmpty: Story = {
  name: 'Royalty Drafts · Empty (window closed)',
  render: () => (
    <div className="rounded-lg border border-slate-200 p-6 text-sm text-slate-500">
      Royalty Drafts tab hidden outside the 15-Mar to 30-Apr TMAA
      filing window when no drafts exist.
    </div>
  ),
};

export const RoyaltyDraftsLoading: Story = {
  name: 'Royalty Drafts · Loading',
  render: () => <SectionSkeleton sectionLabel="Royalty Drafts" />,
};

export const RoyaltyDraftsPopulated: Story = {
  name: 'Royalty Drafts · Populated',
  render: () => (
    <RoyaltyDraftsSection {...baseProps} entityType="royalty-drafts" />
  ),
};

/* ---------------- Active Shifts ---------------- */

export const ActiveShiftsEmpty: Story = {
  name: 'Active Shifts · Empty',
  render: () => (
    <div className="rounded-lg border border-slate-200 p-6 text-sm text-slate-500">
      Active Shifts tab hidden until a shift is opened on any site.
    </div>
  ),
};

export const ActiveShiftsLoading: Story = {
  name: 'Active Shifts · Loading',
  render: () => <SectionSkeleton sectionLabel="Active Shifts" />,
};

export const ActiveShiftsPopulated: Story = {
  name: 'Active Shifts · Populated',
  render: () => (
    <ActiveShiftsSection {...baseProps} entityType="active-shifts" />
  ),
};

/* ---------------- Ore Parcels ---------------- */

export const OreParcelsEmpty: Story = {
  name: 'Ore Parcels · Empty',
  render: () => (
    <div className="rounded-lg border border-slate-200 p-6 text-sm text-slate-500">
      Ore Parcels tab hidden until the first parcel is weighed and
      added to inventory.
    </div>
  ),
};

export const OreParcelsLoading: Story = {
  name: 'Ore Parcels · Loading',
  render: () => <SectionSkeleton sectionLabel="Ore Parcels" />,
};

export const OreParcelsPopulated: Story = {
  name: 'Ore Parcels · Populated',
  render: () => (
    <OreParcelsSection {...baseProps} entityType="ore-parcels" />
  ),
};

/* ---------------- NEMC Filings ---------------- */

export const NemcFilingsEmpty: Story = {
  name: 'NEMC Filings · Empty',
  render: () => (
    <div className="rounded-lg border border-slate-200 p-6 text-sm text-slate-500">
      NEMC Filings tab hidden outside the open filing window when no
      historical filings exist for this tenant.
    </div>
  ),
};

export const NemcFilingsLoading: Story = {
  name: 'NEMC Filings · Loading',
  render: () => <SectionSkeleton sectionLabel="NEMC Filings" />,
};

export const NemcFilingsPopulated: Story = {
  name: 'NEMC Filings · Populated',
  render: () => (
    <NemcFilingsSection {...baseProps} entityType="nemc-filings" />
  ),
};

/* ---------------- Geology Logs ---------------- */

export const GeologyLogsEmpty: Story = {
  name: 'Geology Logs · Empty (role-gated)',
  render: () => (
    <div className="rounded-lg border border-slate-200 p-6 text-sm text-slate-500">
      Geology Logs tab is hidden when the viewer lacks a drill-capable
      role (geologist / mine_manager / owner / platform_ops).
    </div>
  ),
};

export const GeologyLogsLoading: Story = {
  name: 'Geology Logs · Loading',
  render: () => <SectionSkeleton sectionLabel="Geology Logs" />,
};

export const GeologyLogsPopulated: Story = {
  name: 'Geology Logs · Populated',
  render: () => (
    <GeologyLogsSection {...baseProps} entityType="geology-logs" />
  ),
};

/* ---------------- Compliance Deadlines ---------------- */

export const ComplianceDeadlinesEmpty: Story = {
  name: 'Compliance Deadlines · Empty (>30 days)',
  render: () => (
    <div className="rounded-lg border border-slate-200 p-6 text-sm text-slate-500">
      Compliance Deadlines tab hidden until at least one statutory
      deadline is due within the next 30 days.
    </div>
  ),
};

export const ComplianceDeadlinesLoading: Story = {
  name: 'Compliance Deadlines · Loading',
  render: () => <SectionSkeleton sectionLabel="Compliance Deadlines" />,
};

export const ComplianceDeadlinesPopulated: Story = {
  name: 'Compliance Deadlines · Populated',
  render: () => (
    <ComplianceDeadlinesSection
      {...baseProps}
      entityType="compliance-deadlines-30d"
    />
  ),
};

/* ---------------- Cooperative Membership ---------------- */

export const CooperativeMembershipEmpty: Story = {
  name: 'Cooperative Membership · Empty (non-member)',
  render: () => (
    <div className="rounded-lg border border-slate-200 p-6 text-sm text-slate-500">
      Cooperative Membership tab is gated by the
      `cooperative-member` feature flag — set ON when the org joins
      a registered cooperative.
    </div>
  ),
};

export const CooperativeMembershipLoading: Story = {
  name: 'Cooperative Membership · Loading',
  render: () => <SectionSkeleton sectionLabel="Cooperative Membership" />,
};

export const CooperativeMembershipPopulated: Story = {
  name: 'Cooperative Membership · Populated',
  render: () => (
    <CooperativeMembershipSection
      {...baseProps}
      entityType="cooperative-membership"
    />
  ),
};
