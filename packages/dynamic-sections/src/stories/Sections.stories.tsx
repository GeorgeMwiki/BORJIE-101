/**
 * Storybook deck — every J1 seed section in three states:
 *   - Empty (no data; section is hidden from a real DynamicTabBar)
 *   - Loading (skeleton fallback)
 *   - Populated (the stub component rendered)
 *
 * Each section gets a story rather than a parameterised one so the
 * design QA pass can flip through them quickly + reviewers can
 * link to a specific section's story in PR comments.
 */

import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  EmployeesSection,
  CustomersSection,
  PropertiesSection,
  LeadsSection,
  DealsSection,
  KraFilingsSection,
  CampaignsSection,
  RecommendationsSection,
  InternalStaffSection,
} from '../seed/section-components.js';
import { SectionSkeleton } from '../components/SectionSkeleton.js';

type Story = StoryObj;

const meta: Meta = {
  title: 'DynamicSections/J1 Seed Sections',
  tags: ['autodocs'],
};
export default meta;

const baseProps = {
  tenantId: 'demo-tenant-tz-01',
  orgId: 'demo-org-cbd',
  scope: 'owner-customer' as const,
};

/* ---------------- Employees ---------------- */

export const EmployeesEmpty: Story = {
  name: 'Employees · Empty (no data)',
  render: () => (
    <div className="rounded-lg border border-slate-200 p-6 text-sm text-slate-500">
      The Employees tab is hidden when the tenant has zero employees.
      This story documents the implicit empty state — the section is
      simply not rendered.
    </div>
  ),
};

export const EmployeesLoading: Story = {
  name: 'Employees · Loading',
  render: () => <SectionSkeleton sectionLabel="Employees" />,
};

export const EmployeesPopulated: Story = {
  name: 'Employees · Populated',
  render: () => <EmployeesSection {...baseProps} entityType="employees" />,
};

/* ---------------- Customers ---------------- */

export const CustomersEmpty: Story = {
  name: 'Customers · Empty (no data)',
  render: () => (
    <div className="rounded-lg border border-slate-200 p-6 text-sm text-slate-500">
      Customers tab hidden until the first customer is created.
    </div>
  ),
};

export const CustomersLoading: Story = {
  name: 'Customers · Loading',
  render: () => <SectionSkeleton sectionLabel="Customers" />,
};

export const CustomersPopulated: Story = {
  name: 'Customers · Populated',
  render: () => <CustomersSection {...baseProps} entityType="customers" />,
};

/* ---------------- Properties ---------------- */

export const PropertiesEmpty: Story = {
  name: 'Properties · Empty',
  render: () => (
    <div className="rounded-lg border border-slate-200 p-6 text-sm text-slate-500">
      Properties tab hidden until the first property is registered.
    </div>
  ),
};

export const PropertiesLoading: Story = {
  name: 'Properties · Loading',
  render: () => <SectionSkeleton sectionLabel="Properties" />,
};

export const PropertiesPopulated: Story = {
  name: 'Properties · Populated',
  render: () => <PropertiesSection {...baseProps} entityType="properties" />,
};

/* ---------------- Leads ---------------- */

export const LeadsEmpty: Story = {
  name: 'Leads · Empty',
  render: () => (
    <div className="rounded-lg border border-slate-200 p-6 text-sm text-slate-500">
      Leads tab hidden until top-of-funnel activity arrives.
    </div>
  ),
};

export const LeadsLoading: Story = {
  name: 'Leads · Loading',
  render: () => <SectionSkeleton sectionLabel="Leads" />,
};

export const LeadsPopulated: Story = {
  name: 'Leads · Populated',
  render: () => <LeadsSection {...baseProps} entityType="leads" />,
};

/* ---------------- Deals ---------------- */

export const DealsEmpty: Story = {
  name: 'Deals · Empty',
  render: () => (
    <div className="rounded-lg border border-slate-200 p-6 text-sm text-slate-500">
      Deals tab hidden until an active negotiation exists.
    </div>
  ),
};

export const DealsLoading: Story = {
  name: 'Deals · Loading',
  render: () => <SectionSkeleton sectionLabel="Deals" />,
};

export const DealsPopulated: Story = {
  name: 'Deals · Populated',
  render: () => <DealsSection {...baseProps} entityType="deals" />,
};

/* ---------------- KRA Filings ---------------- */

export const KraFilingsEmpty: Story = {
  name: 'KRA Filings · Empty',
  render: () => (
    <div className="rounded-lg border border-slate-200 p-6 text-sm text-slate-500">
      KRA Filings tab hidden until the first statutory filing is submitted.
    </div>
  ),
};

export const KraFilingsLoading: Story = {
  name: 'KRA Filings · Loading',
  render: () => <SectionSkeleton sectionLabel="KRA Filings" />,
};

export const KraFilingsPopulated: Story = {
  name: 'KRA Filings · Populated',
  render: () => <KraFilingsSection {...baseProps} entityType="kra-filings" />,
};

/* ---------------- Campaigns ---------------- */

export const CampaignsEmpty: Story = {
  name: 'Campaigns · Empty',
  render: () => (
    <div className="rounded-lg border border-slate-200 p-6 text-sm text-slate-500">
      Campaigns tab hidden until the marketing-brain launches its first.
    </div>
  ),
};

export const CampaignsLoading: Story = {
  name: 'Campaigns · Loading',
  render: () => <SectionSkeleton sectionLabel="Campaigns" />,
};

export const CampaignsPopulated: Story = {
  name: 'Campaigns · Populated',
  render: () => <CampaignsSection {...baseProps} entityType="campaigns" />,
};

/* ---------------- Recommendations ---------------- */

export const RecommendationsEmpty: Story = {
  name: 'Recommendations · Empty',
  render: () => (
    <div className="rounded-lg border border-slate-200 p-6 text-sm text-slate-500">
      Recommendations tab hidden until an AI suggestion is queued.
    </div>
  ),
};

export const RecommendationsLoading: Story = {
  name: 'Recommendations · Loading',
  render: () => <SectionSkeleton sectionLabel="Recommendations" />,
};

export const RecommendationsPopulated: Story = {
  name: 'Recommendations · Populated',
  render: () => (
    <RecommendationsSection {...baseProps} entityType="recommendations" />
  ),
};

/* ---------------- Internal Staff ---------------- */

export const InternalStaffEmpty: Story = {
  name: 'Internal Staff · Empty (admin-only)',
  render: () => (
    <div className="rounded-lg border border-slate-200 p-6 text-sm text-slate-500">
      Internal Staff tab is restricted to the internal-admin scope AND
      requires the `platform_ops` role. Hidden by default.
    </div>
  ),
};

export const InternalStaffLoading: Story = {
  name: 'Internal Staff · Loading',
  render: () => <SectionSkeleton sectionLabel="Internal Staff" />,
};

export const InternalStaffPopulated: Story = {
  name: 'Internal Staff · Populated',
  render: () => (
    <InternalStaffSection
      tenantId="platform-ops-tenant"
      scope="internal-admin"
      entityType="internal-staff"
    />
  ),
};
