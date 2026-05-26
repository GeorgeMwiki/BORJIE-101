-- =============================================================================
-- 0029: IoT sensor observations + anomalies — Wave 8 gap closure (S3)
-- =============================================================================
-- Customer-research directive (S3): "additional vectors to add (deep research):
-- tenant feedback loops, IoT sensors (if available), satellite imagery for
-- land-use verification, scheduled drone/site visits, automated compliance
-- checks."
--
-- Three tables:
--   - iot_sensors — registered physical/virtual sensors (water meter,
--     electricity meter, door-lock, smoke, occupancy, satellite image feed)
--   - iot_observations — time-series sensor readings (append-only)
--   - iot_anomalies — detected anomalies (threshold breach, silence,
--     tamper, unusual pattern) that trigger downstream events
-- =============================================================================

CREATE TABLE IF NOT EXISTS iot_sensors (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL
                 CHECK (kind IN (
                   'water_meter','electricity_meter','gas_meter',
                   'temperature','humidity','occupancy','door_lock',
                   'smoke','co','vibration','satellite_image',
                   'drone_scan','custom'
                 )),
  external_id    TEXT NOT NULL,                             -- vendor-assigned ID
  vendor         TEXT NOT NULL,                             -- 'helium','particle','aws-iot','sigfox','nb-iot','manual'
  unit_id        TEXT,                                      -- bound to a unit (optional)
  property_id    TEXT,                                      -- bound to a property (optional)
  geo_node_id    TEXT,                                      -- bound to a geo-node (e.g., district-level aggregate)
  label          TEXT,                                      -- human-readable
  unit_of_measure TEXT,                                     -- 'litres','kWh','degC','count','boolean'
  sampling_interval_seconds INTEGER,
  expected_min   DOUBLE PRECISION,                          -- anomaly bounds
  expected_max   DOUBLE PRECISION,
  silence_threshold_seconds INTEGER,                        -- silence => anomaly
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  metadata       JSONB NOT NULL DEFAULT '{}'::jsonb,
  registered_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at   TIMESTAMPTZ,
  UNIQUE (tenant_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_iot_sensors_tenant ON iot_sensors(tenant_id);
CREATE INDEX IF NOT EXISTS idx_iot_sensors_unit ON iot_sensors(unit_id) WHERE unit_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_iot_sensors_property ON iot_sensors(property_id) WHERE property_id IS NOT NULL;

-- Append-only time-series. Partitioning by month is production-grade but
-- deferred — single table is fine through pilot.
CREATE TABLE IF NOT EXISTS iot_observations (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sensor_id      TEXT NOT NULL REFERENCES iot_sensors(id) ON DELETE CASCADE,
  observed_at    TIMESTAMPTZ NOT NULL,
  numeric_value  DOUBLE PRECISION,
  boolean_value  BOOLEAN,
  string_value   TEXT,
  jsonb_value    JSONB,
  quality        TEXT NOT NULL DEFAULT 'good'
                 CHECK (quality IN ('good','suspect','bad')),
  raw_payload    JSONB,                                     -- original vendor payload for audit
  ingested_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_iot_obs_tenant_time ON iot_observations(tenant_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_iot_obs_sensor_time ON iot_observations(sensor_id, observed_at DESC);
-- BRIN is ideal for append-heavy time-series once the table grows
CREATE INDEX IF NOT EXISTS brin_iot_obs_time ON iot_observations USING BRIN(observed_at);

CREATE TABLE IF NOT EXISTS iot_anomalies (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sensor_id      TEXT NOT NULL REFERENCES iot_sensors(id) ON DELETE CASCADE,
  detected_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  anomaly_type   TEXT NOT NULL
                 CHECK (anomaly_type IN (
                   'threshold_breach','silence','tamper','pattern',
                   'calibration_drift','value_spike','cross_sensor_mismatch'
                 )),
  severity       TEXT NOT NULL DEFAULT 'medium'
                 CHECK (severity IN ('low','medium','high','critical')),
  observation_id TEXT REFERENCES iot_observations(id) ON DELETE SET NULL,
  observed_value DOUBLE PRECISION,
  expected_range_min DOUBLE PRECISION,
  expected_range_max DOUBLE PRECISION,
  message        TEXT NOT NULL,
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by TEXT,
  resolved_at    TIMESTAMPTZ,
  resolved_by    TEXT,
  resolution_notes TEXT,
  metadata       JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_iot_anomalies_tenant ON iot_anomalies(tenant_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_iot_anomalies_sensor ON iot_anomalies(sensor_id);
CREATE INDEX IF NOT EXISTS idx_iot_anomalies_unresolved ON iot_anomalies(tenant_id, severity)
  WHERE resolved_at IS NULL;
