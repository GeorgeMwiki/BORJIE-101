/**
 * Owner-OS panel barrel.
 *
 * Importing this module from any owner-web entry point auto-registers
 * every panel descriptor with the @borjie/owner-os-tabs singleton
 * registry. Each panel exports:
 *   - <Panel> — React component implementing OwnerOSPanelProps
 *   - <PANEL>_DESCRIPTOR — the registered descriptor (mostly for tests)
 *
 * The shell consumes the registry to render the tab strip + spawn menu;
 * the renderer map below ties descriptor.rendererId → React component
 * so the descriptors themselves stay React-free.
 */

import type { ComponentType } from 'react';
import type { OwnerOSPanelProps } from './types';

// IMPORTANT: every panel module's top-level `registerTab(...)` call
// runs exactly once at import time. Keep this list complete so the
// registry hydrates fully whenever the shell mounts.
import { HRPanel } from './HRPanel';
import { CompliancePanel } from './CompliancePanel';
import { FinancePanel } from './FinancePanel';
import { TreasuryPanel } from './TreasuryPanel';
import { MarketplacePanel } from './MarketplacePanel';
import { LicencesPanel } from './LicencesPanel';
import { SitesPanel } from './SitesPanel';
import { SafetyPanel } from './SafetyPanel';
import { WorkforcePanel } from './WorkforcePanel';
import { OpsPanel } from './OpsPanel';
import { RiskPanel } from './RiskPanel';
import { AccountingPanel } from './AccountingPanel';
import { AuditPanel } from './AuditPanel';
import { ESGPanel } from './ESGPanel';
import { GeologyPanel } from './GeologyPanel';
import { ProcurementPanel } from './ProcurementPanel';
import { LegalPanel } from './LegalPanel';
import { ReportsPanel } from './ReportsPanel';
import { SubsidiariesPanel } from './SubsidiariesPanel';
import { HoldingsPanel } from './HoldingsPanel';
import { FamilyOfficePanel } from './FamilyOfficePanel';
import { SuccessionPanel } from './SuccessionPanel';
import { AncillaryBusinessesPanel } from './AncillaryBusinessesPanel';
import { AssetRegisterPanel } from './AssetRegisterPanel';
// Wave OPS-WIDE — full end-to-end mining operations scope.
import { CounterpartiesPanel } from './CounterpartiesPanel';
import { ChainOfCustodyPanel } from './ChainOfCustodyPanel';
import { RegulatoryFilingsPanel } from './RegulatoryFilingsPanel';
import { CSRCommunityPanel } from './CSRCommunityPanel';

export type PanelComponent = ComponentType<OwnerOSPanelProps>;

/**
 * Renderer table — maps a descriptor's `rendererId` string to its React
 * component. Adding a new panel means adding one line here PLUS the
 * descriptor + component in the matching `<Domain>Panel.tsx`.
 */
export const PANEL_RENDERERS: Readonly<Record<string, PanelComponent>> = {
  'panel:hr': HRPanel,
  'panel:compliance': CompliancePanel,
  'panel:finance': FinancePanel,
  'panel:treasury': TreasuryPanel,
  'panel:marketplace': MarketplacePanel,
  'panel:licences': LicencesPanel,
  'panel:sites': SitesPanel,
  'panel:safety': SafetyPanel,
  'panel:workforce': WorkforcePanel,
  'panel:ops': OpsPanel,
  'panel:risk': RiskPanel,
  'panel:accounting': AccountingPanel,
  'panel:audit': AuditPanel,
  'panel:esg': ESGPanel,
  'panel:geology': GeologyPanel,
  'panel:procurement': ProcurementPanel,
  'panel:legal': LegalPanel,
  'panel:reports': ReportsPanel,
  'panel:subsidiaries': SubsidiariesPanel,
  'panel:holdings': HoldingsPanel,
  'panel:family-office': FamilyOfficePanel,
  'panel:succession': SuccessionPanel,
  'panel:ancillary': AncillaryBusinessesPanel,
  'panel:asset-register': AssetRegisterPanel,
  'panel:counterparties': CounterpartiesPanel,
  'panel:chain-of-custody': ChainOfCustodyPanel,
  'panel:regulatory-filings': RegulatoryFilingsPanel,
  'panel:csr-community': CSRCommunityPanel,
};

export {
  HRPanel,
  CompliancePanel,
  FinancePanel,
  TreasuryPanel,
  MarketplacePanel,
  LicencesPanel,
  SitesPanel,
  SafetyPanel,
  WorkforcePanel,
  OpsPanel,
  RiskPanel,
  AccountingPanel,
  AuditPanel,
  ESGPanel,
  GeologyPanel,
  ProcurementPanel,
  LegalPanel,
  ReportsPanel,
  SubsidiariesPanel,
  HoldingsPanel,
  FamilyOfficePanel,
  SuccessionPanel,
  AncillaryBusinessesPanel,
  AssetRegisterPanel,
  CounterpartiesPanel,
  ChainOfCustodyPanel,
  RegulatoryFilingsPanel,
  CSRCommunityPanel,
};

export type { OwnerOSPanelProps } from './types';
