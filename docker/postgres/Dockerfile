# Borjie postgres image — pgvector base + PostGIS extension.
# TimescaleDB is optional; the mining migration wraps create_hypertable in
# DO/EXCEPTION so cash_balances falls back to a plain table when timescale
# is not loaded.
FROM pgvector/pgvector:pg15

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       postgresql-15-postgis-3 \
       postgresql-15-postgis-3-scripts \
  && rm -rf /var/lib/apt/lists/*
