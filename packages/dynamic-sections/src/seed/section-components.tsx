/**
 * Seed section components for the J1 entity types.
 *
 * Each component is a thin stub that:
 *   1. Renders a placeholder ag-ui-shaped surface (so the visual
 *      regression baseline for the host portals is already accurate).
 *   2. Declares the data slice it would fetch in production —
 *      annotated for the backlog so CL-B1's portal wiring follow-up has a
 *      clear hook point.
 *
 * Why stubs: this package ships the FRAMEWORK. The portal-side
 * wiring (real data, real navigation) happens in a follow-up after
 * CL-B1's round-3 closure on owner-portal + admin-web
 * lands. The stubs are the contract — same prop shape, same data-
 * testid surface — so the wiring PR can drop in real implementations
 * without churn.
 */

import type { ReactElement } from 'react';
import type { SectionComponentProps } from '../contracts/section.js';

interface StubProps extends SectionComponentProps {
  readonly title: string;
  readonly description: string;
  readonly genUiPartKind: string;
}

function SectionStub({
  title,
  description,
  genUiPartKind,
  entityType,
  tenantId,
  scope,
  localisedTitle,
  localisedDescription,
}: StubProps): ReactElement {
  return (
    <article
      data-testid={`section-stub-${entityType}`}
      data-genui-kind={genUiPartKind}
      data-scope={scope}
      data-tenant-id={tenantId}
      className="w-full p-4 md:p-6 space-y-3"
    >
      <header className="space-y-1">
        <h2 className="text-lg md:text-xl font-semibold text-slate-900">
          {localisedTitle ?? title}
        </h2>
        <p className="text-sm text-slate-600 max-w-prose">{localisedDescription ?? description}</p>
      </header>
      <div
        data-testid={`section-stub-${entityType}-genui-frame`}
        className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs font-mono text-slate-500"
      >
        {`<${genUiPartKind} tenantId="${tenantId}" entityType="${entityType}" scope="${scope}" />`}
      </div>
    </article>
  );
}

export function EmployeesSection(props: SectionComponentProps): ReactElement {
  return (
    <SectionStub
      {...props}
      title="Employees"
      description="Roster of internal HR records — driven by the kra-resident workforce graph."
      genUiPartKind="data-table"
    />
  );
}

export function CustomersSection(props: SectionComponentProps): ReactElement {
  return (
    <SectionStub
      {...props}
      title="Customers"
      description="Tenants, occupants, and individual lessees the MD has onboarded."
      genUiPartKind="data-table"
    />
  );
}

export function PropertiesSection(props: SectionComponentProps): ReactElement {
  return (
    <SectionStub
      {...props}
      title="Properties"
      description="Units, buildings, and the spatial graph the property-management stack operates on."
      genUiPartKind="map"
    />
  );
}

export function LeadsSection(props: SectionComponentProps): ReactElement {
  return (
    <SectionStub
      {...props}
      title="Leads"
      description="Prospective tenants in the top-of-funnel pipeline."
      genUiPartKind="kanban"
    />
  );
}

export function DealsSection(props: SectionComponentProps): ReactElement {
  return (
    <SectionStub
      {...props}
      title="Deals"
      description="Active negotiations + active leasing pipelines."
      genUiPartKind="kanban"
    />
  );
}

// "KRA Filings" is a Kenya-specific tax-authority surface (Kenya Revenue
// Authority). The literal is the canonical name of the regulator and
// only renders when the consumer does NOT pass `localisedTitle` — and
// in that situation it is correct to render the English name (it is a
// proper noun, like "IRS" in the US).
const KRA_FILINGS_DEFAULT_TITLE = 'KRA Filings';

export function KraFilingsSection(props: SectionComponentProps): ReactElement {
  return (
    <SectionStub
      {...props}
      title={KRA_FILINGS_DEFAULT_TITLE}
      description="Statutory filings + their submission status to the tax authority."
      genUiPartKind="timeline"
    />
  );
}

export function CampaignsSection(props: SectionComponentProps): ReactElement {
  return (
    <SectionStub
      {...props}
      title="Campaigns"
      description="Marketing-brain outreach campaigns + open conversion funnels."
      genUiPartKind="dashboard-grid"
    />
  );
}

export function RecommendationsSection(props: SectionComponentProps): ReactElement {
  return (
    <SectionStub
      {...props}
      title="Recommendations"
      description="AI-generated actions queued for the MD's review."
      genUiPartKind="evidence-card"
    />
  );
}

export function InternalStaffSection(props: SectionComponentProps): ReactElement {
  return (
    <SectionStub
      {...props}
      title="Internal Staff"
      description="Platform-side operators — visible only to the internal-admin scope."
      genUiPartKind="data-table"
    />
  );
}
