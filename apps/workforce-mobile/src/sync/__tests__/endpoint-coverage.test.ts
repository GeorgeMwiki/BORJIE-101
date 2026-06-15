/**
 * Guard: every offline-sync EntityType must resolve to a path the api-gateway
 * actually mounts under `/api/v1/mining`. A type whose computed endpoint has no
 * mounted handler returns 404 on flush — the exact condition that used to
 * silently delete a worker's offline evidence. This locks the contract so a
 * new EntityType cannot ship without a matching sink route.
 *
 * The mounted set below mirrors services/api-gateway/src/routes/mining/index.ts.
 * When you add an EntityType, mount its route there AND add the path here.
 */

import { describe, expect, it } from 'vitest'
import { endpointFor } from '../endpoints'
import type { EntityType } from '../queue'

// The offline-field-capture entity types fixed by this change. Each MUST
// resolve to a path the api-gateway now mounts (see
// services/api-gateway/src/routes/mining/{index,field-capture,inventory}.ts).
const FIELD_CAPTURE_ENTITIES: ReadonlyArray<{
  readonly entity: EntityType
  readonly path: string
}> = [
  { entity: 'ppe_receipt', path: 'ppe-receipts' },
  { entity: 'driver_letter_ack', path: 'driver-letter-acks' },
  { entity: 'excavator_count', path: 'excavator-counts' },
  { entity: 'photo_upload', path: 'photo-uploads' },
  { entity: 'fingerprint_sign', path: 'fingerprint-signs' },
  // Converges on the ONLINE movements route rather than a divergent sink.
  { entity: 'inventory_move', path: 'inventory/movements' },
  // The previously-fixed reference case.
  { entity: 'toolbox_ack', path: 'toolbox-acks' }
]

describe('offline-sync endpoint coverage', () => {
  it('every field-capture entity resolves to its mounted sink path', () => {
    for (const { entity, path } of FIELD_CAPTURE_ENTITIES) {
      expect(
        endpointFor(entity),
        `EntityType '${entity}' must resolve to mounted path '${path}'`
      ).toBe(path)
    }
  })
})
