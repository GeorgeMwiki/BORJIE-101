/**
 * Seed section components for the eight Borjie mining-domain entity
 * types.
 *
 * Each component is a thin stub that:
 *   1. Renders a placeholder ag-ui-shaped surface (so the visual
 *      regression baseline for the host portals is already accurate).
 *   2. Declares the data slice it would fetch in production —
 *      annotated for the backlog so the portal wiring follow-up has a
 *      clear hook point.
 *
 * Why stubs: this package ships the FRAMEWORK. The portal-side
 * wiring (real data, real navigation) lives in the host apps
 * (`apps/owner-web/`, `apps/admin-web/`). The stubs are the contract
 * — same prop shape, same data-testid surface — so a wiring change
 * can drop in real implementations without churn.
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

export function PmlLicencesSection(
  props: SectionComponentProps,
): ReactElement {
  return (
    <SectionStub
      {...props}
      title="PML Licences"
      description="Primary Mining Licence registrations issued under the Mining Act 2010 — status, expiry, royalty obligations."
      genUiPartKind="data-table"
    />
  );
}

export function RoyaltyDraftsSection(
  props: SectionComponentProps,
): ReactElement {
  return (
    <SectionStub
      {...props}
      title="Royalty Drafts"
      description="Royalty filing drafts queued for TMAA / GePG submission. Active during the 15-Mar to 30-Apr filing window."
      genUiPartKind="kanban"
    />
  );
}

export function ActiveShiftsSection(
  props: SectionComponentProps,
): ReactElement {
  return (
    <SectionStub
      {...props}
      title="Active Shifts"
      description="Real-time crew shifts in progress across every active mining site."
      genUiPartKind="dashboard-grid"
    />
  );
}

export function OreParcelsSection(
  props: SectionComponentProps,
): ReactElement {
  return (
    <SectionStub
      {...props}
      title="Ore Parcels"
      description="Weighed, sampled, and graded ore parcels in inventory awaiting buyer assignment or transport."
      genUiPartKind="data-table"
    />
  );
}

export function NemcFilingsSection(
  props: SectionComponentProps,
): ReactElement {
  return (
    <SectionStub
      {...props}
      title="NEMC Filings"
      description="National Environment Management Council statutory filings + monitoring reports."
      genUiPartKind="timeline"
    />
  );
}

export function GeologyLogsSection(
  props: SectionComponentProps,
): ReactElement {
  return (
    <SectionStub
      {...props}
      title="Geology Logs"
      description="Drill, blast, and sample logs captured by certified geologists. Role-gated."
      genUiPartKind="data-table"
    />
  );
}

export function ComplianceDeadlinesSection(
  props: SectionComponentProps,
): ReactElement {
  return (
    <SectionStub
      {...props}
      title="Compliance Deadlines"
      description="Statutory deadlines (TMAA, NEMC, KRA, OSHA) coming due within 30 days."
      genUiPartKind="timeline"
    />
  );
}

export function CooperativeMembershipSection(
  props: SectionComponentProps,
): ReactElement {
  return (
    <SectionStub
      {...props}
      title="Cooperative Membership"
      description="Membership, settlement, and dues activity in the registered mining cooperative."
      genUiPartKind="dashboard-grid"
    />
  );
}
