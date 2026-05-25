/**
 * Mocks for the lighter-touch operations screens: people, fleet,
 * inventory, geology workbench. Each screen keeps a polished stub but
 * surfaces a real working dataset so the owner can see the shape.
 */

export const PEOPLE_MOCK = {
  orgChart: [
    { id: 'p_owner', name: 'Mzee Mwanaidi Komba', role: 'Owner', reportsTo: null },
    { id: 'p_mm', name: 'Hawa Shabani', role: 'Mine Manager', reportsTo: 'p_owner' },
    { id: 'p_sv1', name: 'Salim Mwakatobe', role: 'Day-shift Supervisor', reportsTo: 'p_mm' },
    { id: 'p_sv2', name: 'Lucy Nkya', role: 'Night-shift Supervisor', reportsTo: 'p_mm' },
    { id: 'p_acc', name: 'Sospeter Mlay', role: 'Accountant', reportsTo: 'p_owner' },
  ],
  advances: [
    { person: 'Salim Mwakatobe', wageOwedTzs: 1_800_000, advancesTzs: 600_000, agedDays: 14 },
    { person: 'Lucy Nkya', wageOwedTzs: 1_650_000, advancesTzs: 200_000, agedDays: 5 },
    { person: 'Operator team #4', wageOwedTzs: 4_200_000, advancesTzs: 950_000, agedDays: 22 },
  ],
  productivity: [
    { phase: 'Stoping', tphPerCrew: 4.2, target: 4.0 },
    { phase: 'Loading', tphPerCrew: 18.7, target: 21.0 },
    { phase: 'Crushing', tphPerCrew: 12.4, target: 13.5 },
  ],
} as const;

export const FLEET_MOCK = {
  units: [
    { id: 'exc_01', label: 'Excavator-1 (Hitachi)', healthScore: 82, hours: 4180, status: 'ok' },
    { id: 'exc_02', label: 'Excavator-2 (Komatsu)', healthScore: 64, hours: 6210, status: 'watch' },
    { id: 'hl_01', label: 'Haul truck HL-1', healthScore: 71, hours: 3120, status: 'ok' },
    { id: 'hl_02', label: 'Haul truck HL-2', healthScore: 41, hours: 7900, status: 'service-due' },
  ],
  matchFactor: 0.86,
  matchFactorTarget: 1.0,
} as const;

export const INVENTORY_MOCK = {
  consumables: [
    { sku: 'CYN-NaCN-50kg', label: 'Sodium cyanide 50kg', daysCover: 11, reorderAtDays: 14 },
    { sku: 'FUEL-D-L', label: 'Diesel (L)', daysCover: 9, reorderAtDays: 14 },
    { sku: 'PPE-HHAT', label: 'Hard hats', daysCover: 48, reorderAtDays: 21 },
    { sku: 'MILL-BALL-65', label: 'Mill balls 65mm', daysCover: 21, reorderAtDays: 14 },
  ],
  suppliers: [
    { name: 'Mwanza Chem Co.', tin: '102-345-001', itcStatus: 'valid' },
    { name: 'Geita Diesel Services', tin: '108-902-201', itcStatus: 'valid' },
    { name: 'Tabora Hardware', tin: '120-411-302', itcStatus: 'expired' },
  ],
} as const;

export const GEOLOGY_MOCK = {
  resource: {
    indicatedTonnes: 84_500,
    indicatedGradeGpt: 4.1,
    inferredTonnes: 142_000,
    inferredGradeGpt: 3.4,
    lastSignedOff: '2026-03-14',
  },
  qaqc: [
    { type: 'Duplicates', passRate: 0.94, threshold: 0.9 },
    { type: 'Blanks', passRate: 0.98, threshold: 0.95 },
    { type: 'CRMs', passRate: 0.89, threshold: 0.9 },
  ],
} as const;
