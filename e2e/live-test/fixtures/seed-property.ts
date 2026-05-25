/**
 * Programmatic property + units creation via the api-gateway.
 *
 * Used by `03-property-add.spec.ts`. The shape matches the owner-portal's
 * property-create form so this fixture is a faithful proxy for what the
 * real UI does. Four units are created with deterministic numbering
 * (A101..A104) so subsequent specs can reference unit-1 directly.
 */
import { tryPaths, type AuthedRequest } from './tenant-context';
import { setLiveTestState } from './seed-tenant';

export interface SeededProperty {
  propertyId: string;
  unitIds: readonly string[];
}

interface PropertyInput {
  name: string;
  address: string;
  unitCount: number;
  baseRentKes: number;
}

const DEFAULT_INPUT: PropertyInput = {
  name: 'Live-Test Apartments',
  // eslint-disable-next-line borjie/no-jurisdictional-literal -- pilot-country E2E test seed address
  address: '42 Live Test Avenue, Westlands, Nairobi',
  unitCount: 4,
  baseRentKes: 45000,
};

/** Create a property and `unitCount` units under it. */
export async function seedProperty(
  authed: AuthedRequest,
  input: PropertyInput = DEFAULT_INPUT,
): Promise<SeededProperty> {
  // 1) Create the property.
  const propResp = await tryPaths(
    authed,
    'POST',
    ['/api/v1/properties', '/api/properties'],
    {
      name: input.name,
      address: input.address,
      status: 'active',
    },
  );
  if (propResp.status >= 400) {
    throw new Error(
      `seedProperty (property): ${propResp.status} via ${propResp.path} :: ${JSON.stringify(propResp.body).slice(0, 200)}`,
    );
  }
  const propertyId = extractId(propResp.body);
  if (!propertyId) {
    throw new Error(`seedProperty: property created but returned no id`);
  }

  // 2) Create the units.
  const unitIds: string[] = [];
  for (let i = 0; i < input.unitCount; i += 1) {
    const unitNumber = `A${101 + i}`;
    const unitResp = await tryPaths(
      authed,
      'POST',
      ['/api/v1/units', '/api/units'],
      {
        propertyId,
        unitNumber,
        status: 'vacant',
        monthlyRent: input.baseRentKes,
      },
    );
    if (unitResp.status >= 400) {
      throw new Error(
        `seedProperty (unit ${unitNumber}): ${unitResp.status} :: ${JSON.stringify(unitResp.body).slice(0, 200)}`,
      );
    }
    const unitId = extractId(unitResp.body);
    if (!unitId) {
      throw new Error(`seedProperty: unit ${unitNumber} returned no id`);
    }
    unitIds.push(unitId);
  }

  setLiveTestState({ propertyId, unitIds });
  return { propertyId, unitIds: Object.freeze(unitIds) };
}

function extractId(body: unknown): string {
  const parsed = body as {
    data?: { id?: string };
    id?: string;
  };
  return parsed?.data?.id ?? parsed?.id ?? '';
}
