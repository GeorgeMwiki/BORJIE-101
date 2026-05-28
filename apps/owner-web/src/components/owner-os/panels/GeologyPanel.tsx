'use client';

import type { ReactElement } from 'react';
import { Microscope, Pickaxe } from 'lucide-react';
import {
  ownerOsTabContextSchema,
  registerTab,
  type OwnerOSTabDescriptor,
} from '@borjie/owner-os-tabs';
import { PanelHero } from './PanelHero';
import { EmptyPanelBody } from './EmptyPanelBody';
import type { OwnerOSPanelProps } from './types';

const GEOLOGY_DESCRIPTOR: OwnerOSTabDescriptor = {
  type: 'geology',
  labelEn: 'Geology',
  labelSw: 'Jiolojia',
  descriptionEn: 'Drill-hole log, assay results and orebody confidence.',
  descriptionSw: 'Kumbukumbu za visima, matokeo ya assay na imani ya orebody.',
  iconName: 'Microscope',
  color: 'navy',
  contextSchema: ownerOsTabContextSchema,
  intentMatchers: {
    keywords: [
      'geology',
      'drill',
      'assay',
      'orebody',
      'grade',
      'core',
      'sample',
      'reef',
      'jiolojia',
      'sampuli',
    ],
    comboBoost: [
      { phrases: ['drill', 'hole'], boost: 0.25 },
      { phrases: ['assay', 'result'], boost: 0.2 },
    ],
  },
  suggestedTools: [
    {
      toolId: 'geology.upload-assay',
      labelEn: 'Upload assay results',
      labelSw: 'Pakia matokeo ya assay',
    },
  ],
  briefSlices: ['sites', 'inventory'],
  rendererId: 'panel:geology',
};

registerTab(GEOLOGY_DESCRIPTOR);

export const GEOLOGY_PANEL_DESCRIPTOR = GEOLOGY_DESCRIPTOR;

export function GeologyPanel({
  locale,
}: OwnerOSPanelProps): ReactElement {
  return (
    <section
      className="flex flex-col gap-5 px-2 py-2"
      data-testid="owner-os-panel-geology"
    >
      <PanelHero
        icon={Microscope}
        color="navy"
        titleEn="Geology"
        titleSw="Jiolojia"
        subtitleEn="Drill-hole log, assay queue and orebody-confidence sparkline per site."
        subtitleSw="Kumbukumbu za visima, foleni ya assay na mkondo wa imani ya orebody kwa tovuti."
        locale={locale}
      />
      <EmptyPanelBody
        icon={Pickaxe}
        titleEn="Geology surface landing soon"
        titleSw="Eneo la jiolojia linakuja hivi karibuni"
        bodyEn="The drill-hole log already exists in the geology service. This panel will surface a per-site assay queue and orebody-confidence chart once /api/v1/geology/drillholes is exposed."
        bodySw="Kumbukumbu za visima tayari zipo kwenye huduma ya jiolojia. Paneli hii itaonyesha foleni ya assay kwa tovuti na chati ya imani ya orebody mara tu /api/v1/geology/drillholes itakapozinduliwa."
        contractEn="GET /api/v1/geology/drillholes?siteId=..."
        contractSw="GET /api/v1/geology/drillholes?siteId=..."
        locale={locale}
      />
    </section>
  );
}
