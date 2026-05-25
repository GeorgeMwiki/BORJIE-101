/**
 * Move-In / Move-Out Checklist Template
 * Condition inspection checklist for property handover.
 */

export interface ChecklistItem {
  readonly room: string;
  readonly item: string;
  readonly moveInCondition?: string;
  readonly moveOutCondition?: string;
  readonly notes?: string;
}

export interface MoveInOutChecklistTemplateData {
  readonly tenantName: string;
  readonly propertyAddress: string;
  readonly unitIdentifier: string;
  readonly inspectionType: 'move_in' | 'move_out';
  readonly inspectionDate: string;
  readonly rooms: readonly {
    readonly name: string;
    readonly items: readonly string[];
  }[];
  readonly meterReadings?: readonly { utility: string; reading: string }[];
  readonly keysReceived?: string[];
  readonly overallCondition?: string;
}

/** Default room-item structure for standard units */
export const DEFAULT_CHECKLIST_ROOMS = [
  { name: 'Living Room', items: ['Walls', 'Floor', 'Ceiling', 'Windows', 'Doors', 'Light fixtures'] },
  { name: 'Kitchen', items: ['Cabinets', 'Countertops', 'Sink', 'Appliances', 'Floor', 'Walls'] },
  { name: 'Bedroom', items: ['Walls', 'Floor', 'Windows', 'Doors', 'Light fixtures', 'Closet'] },
  { name: 'Bathroom', items: ['Tiles', 'Toilet', 'Sink', 'Shower/Bath', 'Mirror', 'Ventilation'] },
] as const;

/** Generate move-in/move-out checklist document */
export function generateMoveInOutChecklist(data: MoveInOutChecklistTemplateData): string {
  const typeLabel = data.inspectionType === 'move_in' ? 'MOVE-IN' : 'MOVE-OUT';
  const condCol = data.inspectionType === 'move_in' ? 'Condition at Move-In' : 'Condition at Move-Out';

  let content = `
${typeLabel} INSPECTION CHECKLIST

Property: ${data.propertyAddress}
Unit: ${data.unitIdentifier}
Tenant: ${data.tenantName}
Date: ${data.inspectionDate}
${data.overallCondition ? `Overall Condition: ${data.overallCondition}` : ''}

ROOM INSPECTION
${'─'.repeat(60)}
`;

  for (const room of data.rooms) {
    content += `\n${room.name}\n`;
    for (const item of room.items) {
      content += `  - ${item}: [${condCol}] ___________ Notes: ___________\n`;
    }
  }

  if (data.meterReadings?.length) {
    content += `\nMETER READINGS\n${'─'.repeat(60)}\n`;
    for (const m of data.meterReadings) {
      content += `  ${m.utility}: ${m.reading}\n`;
    }
  }

  if (data.keysReceived?.length) {
    content += `\nKEYS RECEIVED\n${'─'.repeat(60)}\n`;
    for (const k of data.keysReceived) {
      content += `  - ${k}\n`;
    }
  }

  content += `
SIGNATURES
Inspector: _________________________  Date: _______
Tenant:    _________________________  Date: _______
`;

  return content.trim();
}

/** Template identifier */
export const MOVE_IN_OUT_CHECKLIST_TEMPLATE_ID = 'move-in-out-checklist-v1';
