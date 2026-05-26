/**
 * Hand-written OpenAPI 3.1 component schemas for the Borjie mining API.
 *
 * Best-effort mirror of the Zod schemas in
 * `services/api-gateway/src/routes/mining/*.hono.ts`. Drift may exist —
 * the upstream Zod schemas are the source of truth. Anything not listed
 * here surfaces in the spec as an opaque `{}` body and the path item
 * carries an `x-zod-schema-unmapped: true` extension so consumers can
 * grep for gaps.
 *
 * Used by `scripts/generate-openapi-spec.mjs`.
 */

/** Envelope returned by every Hono handler on success. */
const SuccessEnvelope = (dataSchema = { type: 'object', additionalProperties: true }) => ({
  type: 'object',
  required: ['success'],
  properties: {
    success: { type: 'boolean', const: true },
    data: dataSchema,
    meta: { type: 'object', additionalProperties: true },
  },
});

/** Envelope returned on validation / business errors. */
const ErrorEnvelope = {
  type: 'object',
  required: ['success', 'error'],
  properties: {
    success: { type: 'boolean', const: false },
    error: {
      type: 'object',
      required: ['code', 'message'],
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        details: { type: 'object', additionalProperties: true },
      },
    },
  },
};

/**
 * Map of `<SchemaName>` → JSON-Schema object. Names match the Zod
 * variable names used inside the .hono.ts files so the generator can
 * resolve `zValidator('json', <SchemaName>)` → `$ref`.
 */
export const componentSchemas = {
  // ===== Envelopes =====
  ApiSuccessEnvelope: SuccessEnvelope(),
  ApiErrorEnvelope: ErrorEnvelope,

  // ===== Sites =====
  CreateSiteSchema: {
    type: 'object',
    required: ['licenceId', 'name', 'mineral'],
    properties: {
      licenceId: { type: 'string', minLength: 1 },
      name: { type: 'string', minLength: 1, maxLength: 200 },
      mineral: { type: 'string', minLength: 1, maxLength: 80 },
      location: { type: 'string', description: 'GeoJSON POINT' },
      polygon: { type: 'string', description: 'GeoJSON POLYGON' },
      phase: {
        type: 'string',
        enum: [
          'pre_licence', 'exploration', 'access_prep', 'sampling',
          'trenching', 'shafting', 'vein_search', 'confirmation',
          'expansion', 'extraction', 'sorting', 'processing',
          'transport', 'sale', 'rehab', 'renewal_conversion',
        ],
        default: 'pre_licence',
      },
      managerUserId: { type: 'string' },
      attributes: { type: 'object', additionalProperties: true },
    },
  },
  UpdateSiteSchema: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      mineral: { type: 'string' },
      location: { type: 'string' },
      polygon: { type: 'string' },
      phase: { type: 'string' },
      managerUserId: { type: 'string' },
      geologyConfidence: { type: 'string' },
      status: { type: 'string', enum: ['active', 'paused', 'abandoned', 'under_rehab'] },
      attributes: { type: 'object', additionalProperties: true },
    },
  },

  // ===== Licences =====
  CreateLicenceSchema: {
    type: 'object',
    required: ['licenceNumber', 'kind'],
    properties: {
      licenceNumber: { type: 'string' },
      kind: { type: 'string', description: 'e.g. PML, PL, ML, SML' },
      mineral: { type: 'string' },
      area: { type: 'string', description: 'GeoJSON POLYGON' },
      issuedAt: { type: 'string', format: 'date-time' },
      expiryDate: { type: 'string', format: 'date' },
      attributes: { type: 'object', additionalProperties: true },
    },
  },
  RenewSchema: {
    type: 'object',
    required: ['newExpiryDate'],
    properties: {
      newExpiryDate: { type: 'string', format: 'date' },
      notes: { type: 'string', maxLength: 2000 },
    },
  },
  CreateEventSchema: {
    type: 'object',
    required: ['kind'],
    properties: {
      kind: { type: 'string', description: 'e.g. renewed, suspended, dormancy_warning' },
      notes: { type: 'string', maxLength: 2000 },
      attributes: { type: 'object', additionalProperties: true },
    },
  },

  // ===== Drill holes =====
  CreateHoleSchema: {
    type: 'object',
    required: ['siteId', 'name'],
    properties: {
      siteId: { type: 'string' },
      name: { type: 'string', maxLength: 200 },
      kind: { type: 'string', description: 'drill | pit | trench' },
      collar: { type: 'string', description: 'GeoJSON POINT' },
      azimuthDeg: { type: 'number' },
      dipDeg: { type: 'number' },
      depthM: { type: 'number' },
      attributes: { type: 'object', additionalProperties: true },
    },
  },
  CreateLayerSchema: {
    type: 'object',
    required: ['fromM', 'toM', 'lithology'],
    properties: {
      fromM: { type: 'number' },
      toM: { type: 'number' },
      lithology: { type: 'string' },
      gradeGpt: { type: 'number' },
      notes: { type: 'string' },
    },
  },

  // ===== Samples =====
  CreateSampleSchema: {
    type: 'object',
    required: ['siteId', 'sampleNumber'],
    properties: {
      siteId: { type: 'string' },
      sampleNumber: { type: 'string' },
      kind: { type: 'string', description: 'rock | soil | core | grab' },
      collectedAt: { type: 'string', format: 'date-time' },
      attributes: { type: 'object', additionalProperties: true },
    },
  },
  AssayResultSchema: {
    type: 'object',
    required: ['analyte', 'value'],
    properties: {
      analyte: { type: 'string', description: 'e.g. Au, Cu, Fe' },
      value: { type: 'number' },
      unit: { type: 'string', default: 'g/t' },
      labId: { type: 'string' },
      receivedAt: { type: 'string', format: 'date-time' },
    },
  },

  // ===== Shift reports =====
  CreateShiftReportSchema: {
    type: 'object',
    required: ['siteId', 'shiftDate'],
    properties: {
      siteId: { type: 'string' },
      shiftDate: { type: 'string', format: 'date' },
      supervisor: { type: 'string' },
      crewSize: { type: 'integer', minimum: 0 },
      romTonnes: { type: 'number' },
      fuelLitres: { type: 'number' },
      notes: { type: 'string' },
      attributes: { type: 'object', additionalProperties: true },
    },
  },

  // ===== Attendance =====
  CheckInSchema: {
    type: 'object',
    required: ['siteId', 'lat', 'lng'],
    properties: {
      siteId: { type: 'string' },
      lat: { type: 'number' },
      lng: { type: 'number' },
      deviceId: { type: 'string' },
      ts: { type: 'string', format: 'date-time' },
    },
  },
  CheckOutSchema: {
    type: 'object',
    required: ['attendanceId'],
    properties: {
      attendanceId: { type: 'string' },
      lat: { type: 'number' },
      lng: { type: 'number' },
      ts: { type: 'string', format: 'date-time' },
    },
  },

  // ===== Fuel logs =====
  CreateFuelLogSchema: {
    type: 'object',
    required: ['siteId', 'litres'],
    properties: {
      siteId: { type: 'string' },
      assetId: { type: 'string' },
      litres: { type: 'number', exclusiveMinimum: 0 },
      pricePerLitre: { type: 'number' },
      issuedAt: { type: 'string', format: 'date-time' },
      receiptRef: { type: 'string' },
      attributes: { type: 'object', additionalProperties: true },
    },
  },

  // ===== Maintenance =====
  // (Upstream file uses local Zod schemas; precise shape is best-effort.)
  CreateMaintenanceEventSchema: {
    type: 'object',
    required: ['assetId', 'eventType'],
    properties: {
      assetId: { type: 'string' },
      eventType: { type: 'string', description: 'service | breakdown | inspection' },
      hoursMeter: { type: 'number' },
      cost: { type: 'number' },
      vendor: { type: 'string' },
      notes: { type: 'string' },
      ts: { type: 'string', format: 'date-time' },
    },
  },

  // ===== Ore parcels + sales =====
  CreateParcelSchema: {
    type: 'object',
    required: ['siteId', 'tonnes'],
    properties: {
      siteId: { type: 'string' },
      mineral: { type: 'string' },
      tonnes: { type: 'number', minimum: 0 },
      gradeGpt: { type: 'number' },
      location: { type: 'string' },
      attributes: { type: 'object', additionalProperties: true },
    },
  },
  ListForSaleSchema: {
    type: 'object',
    required: ['parcelId'],
    properties: {
      parcelId: { type: 'string' },
      askPriceTzs: { type: 'number' },
      askPriceUsd: { type: 'number' },
      currency: { type: 'string', enum: ['TZS', 'USD'], default: 'TZS' },
      notes: { type: 'string' },
    },
  },
  CreateSaleSchema: {
    type: 'object',
    required: ['parcelId', 'buyerId'],
    properties: {
      parcelId: { type: 'string' },
      buyerId: { type: 'string' },
      grossPriceTzs: { type: 'number' },
      grossPriceUsd: { type: 'number' },
      netTzs: { type: 'number' },
      ts: { type: 'string', format: 'date-time' },
      paymentRef: { type: 'string' },
      attributes: { type: 'object', additionalProperties: true },
    },
  },

  // ===== Incidents + grievances =====
  CreateIncidentSchema: {
    type: 'object',
    required: ['siteId', 'kind', 'severity'],
    properties: {
      siteId: { type: 'string' },
      kind: { type: 'string', description: 'safety | environmental | security' },
      severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
      title: { type: 'string' },
      description: { type: 'string' },
      occurredAt: { type: 'string', format: 'date-time' },
      attributes: { type: 'object', additionalProperties: true },
    },
  },
  CreateGrievanceSchema: {
    type: 'object',
    required: ['siteId', 'category', 'description'],
    properties: {
      siteId: { type: 'string' },
      category: { type: 'string', description: 'community | labour | environment' },
      description: { type: 'string' },
      submittedBy: { type: 'string' },
      contact: { type: 'string' },
      attributes: { type: 'object', additionalProperties: true },
    },
  },

  // ===== Chat =====
  ChatTurnSchema: {
    type: 'object',
    required: ['message'],
    properties: {
      message: { type: 'string', minLength: 1, maxLength: 8000 },
      threadId: { type: 'string' },
      mode: {
        type: 'string',
        enum: ['advisor', 'operator', 'board', 'analyst', 'auditor'],
        default: 'advisor',
      },
      language: { type: 'string', enum: ['sw', 'en'], default: 'sw' },
      evidenceHints: { type: 'array', items: { type: 'string' } },
    },
  },

  // ===== Documents =====
  UploadMetadataSchema: {
    type: 'object',
    required: ['filename'],
    properties: {
      filename: { type: 'string' },
      mimeType: { type: 'string' },
      sha256: { type: 'string' },
      sizeBytes: { type: 'integer' },
      kind: { type: 'string', description: 'licence | contract | assay | other' },
      attributes: { type: 'object', additionalProperties: true },
    },
  },
  DocChatSchema: {
    type: 'object',
    required: ['documentId', 'message'],
    properties: {
      documentId: { type: 'string' },
      message: { type: 'string', minLength: 1, maxLength: 8000 },
    },
  },
  SignSchema: {
    type: 'object',
    required: ['documentId'],
    properties: {
      documentId: { type: 'string' },
      signatoryName: { type: 'string' },
      signatoryRole: { type: 'string' },
      signaturePayload: { type: 'string', description: 'Base64 PNG or detached PKCS#7' },
    },
  },

  // ===== Reports =====
  GenerateReportSchema: {
    type: 'object',
    required: ['kind'],
    properties: {
      kind: { type: 'string', description: 'monthly | quarterly | regulator | board' },
      windowStart: { type: 'string', format: 'date' },
      windowEnd: { type: 'string', format: 'date' },
      recipients: { type: 'array', items: { type: 'string' } },
      attributes: { type: 'object', additionalProperties: true },
    },
  },

  // ===== Marketplace + bids =====
  PlaceBidSchema: {
    type: 'object',
    required: ['listingId'],
    properties: {
      listingId: { type: 'string', minLength: 1 },
      amountTzs: { type: 'integer', minimum: 0 },
      amountUsd: { type: 'integer', minimum: 0 },
      currency: { type: 'string', enum: ['TZS', 'USD'], default: 'TZS' },
      message: { type: 'string', maxLength: 2000 },
    },
  },
  RejectSchema: {
    type: 'object',
    required: ['reason'],
    properties: {
      reason: { type: 'string', minLength: 1, maxLength: 2000 },
    },
  },

  // ===== Buyers KYC =====
  SubmitKycSchema: {
    type: 'object',
    required: ['name', 'kind'],
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 200 },
      kind: { type: 'string', enum: ['trader', 'smelter', 'refinery', 'export_buyer', 'bot', 'broker'] },
      country: { type: 'string', minLength: 2, maxLength: 2, default: 'TZ' },
      companyId: { type: 'string' },
      licenceNumber: { type: 'string', maxLength: 200 },
      nidaId: { type: 'string', minLength: 6, maxLength: 40 },
      tin: { type: 'string', minLength: 6, maxLength: 40 },
      amlScreenResult: { type: 'string', enum: ['clear', 'flagged', 'pending'], default: 'pending' },
      contactName: { type: 'string', maxLength: 200 },
      contactEmail: { type: 'string', format: 'email' },
      contactPhone: { type: 'string', maxLength: 40 },
    },
  },

  // ===== Internal — tenants / corpus / prompts / killswitch =====
  ProvisionSchema: {
    type: 'object',
    required: ['name', 'slug'],
    properties: {
      name: { type: 'string', minLength: 1 },
      slug: { type: 'string', minLength: 1 },
      tier: { type: 'string', description: 'free | starter | pro | enterprise' },
      seats: { type: 'integer', minimum: 1 },
      attributes: { type: 'object', additionalProperties: true },
    },
  },
  PatchSchema: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      tier: { type: 'string' },
      seats: { type: 'integer', minimum: 0 },
      status: { type: 'string', enum: ['active', 'suspended', 'archived'] },
      attributes: { type: 'object', additionalProperties: true },
    },
  },
  PromoteSchema: {
    type: 'object',
    required: ['capability', 'version'],
    properties: {
      capability: { type: 'string', minLength: 1, maxLength: 200 },
      version: { type: 'string', minLength: 1, maxLength: 80 },
    },
  },
  UploadSchema: {
    type: 'object',
    required: ['title'],
    properties: {
      title: { type: 'string' },
      source: { type: 'string' },
      mimeType: { type: 'string' },
      payload: { type: 'string', description: 'Base64 or external URI' },
      attributes: { type: 'object', additionalProperties: true },
    },
  },
  SupersedeSchema: {
    type: 'object',
    required: ['supersededBy'],
    properties: {
      supersededBy: { type: 'string', description: 'ID of replacement corpus version' },
      reason: { type: 'string' },
    },
  },
  SetKillswitchSchema: {
    type: 'object',
    required: ['enabled'],
    properties: {
      enabled: { type: 'boolean' },
      reason: { type: 'string' },
      scope: { type: 'string', description: 'global | tenant | capability' },
      capability: { type: 'string' },
    },
  },
};
