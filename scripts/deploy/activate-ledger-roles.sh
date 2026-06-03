#!/bin/sh
# =============================================================================
# activate-ledger-roles.sh — migration-0275 ACTIVATION step (LP-20c).
#
# !!! RUN ONLY AFTER YOU HAVE VERIFIED ALL OF THE FOLLOWING !!!
#   1. Migration 0275_ledger_roles.sql has been APPLIED to this environment's
#      database (e.g. via `make db-migrate`). That migration creates the two
#      NOLOGIN group roles `borjie_ledger_writer` / `borjie_ledger_reader` and
#      the INSERT-only / SELECT-only grant sets on the money tables.
#   2. The grants are PRESENT — verify with:
#        \dp public.ledger_entries   (writer has INSERT,SELECT; NO update/delete)
#        \du borjie_ledger_writer    (role exists, NOLOGIN)
#        \du borjie_ledger_reader    (role exists, NOLOGIN)
#
# WHAT THIS SCRIPT DOES (and ONLY this — it is privilege ACTIVATION, not
# privilege definition; 0275 already defined the privilege SETS):
#   * Creates the two LOGIN users the running services authenticate as:
#       - ledger_engine_app  -> granted borjie_ledger_writer  (payments-ledger
#                               ENGINE: INSERT-only money path + payment_intents
#                               /accounts lifecycle UPDATE).
#       - ledger_read_app    -> granted borjie_ledger_reader  (ledger-api /
#                               brain reads: SELECT-only).
#   * Reads BOTH passwords from the ENVIRONMENT (never hardcoded, never echoed).
#   * Is IDEMPOTENT: each CREATE ROLE is guarded by a DO-block that swallows
#     duplicate_object, and the password is (re)set with ALTER ROLE so a re-run
#     rotates the secret rather than failing. The GRANTs are idempotent in PG.
#   * Prints the DATABASE_URL repoint instructions for the payments-ledger
#     ENGINE (write) path vs the READ path. It does NOT mutate any service
#     config — that is an operator/IaC action.
#
# WHY a separate step from applying 0275: login users + passwords are
# environment SECRETS provisioned out-of-band, exactly as the migration's
# "DEPLOY STEP (run once per environment, OUTSIDE this migration)" header
# prescribes (see 0275_ledger_roles.sql lines 42-58). Committing them into a
# migration would leak secrets and break the "migrations are immutable" rule.
#
# USAGE
#   LEDGER_ENGINE_PASSWORD='…' \
#   LEDGER_READ_PASSWORD='…' \
#   DATABASE_URL='postgres://superuser@host:5432/borjie' \
#     sh scripts/deploy/activate-ledger-roles.sh
#
# Required env:
#   LEDGER_ENGINE_PASSWORD   password for the ledger_engine_app login user
#   LEDGER_READ_PASSWORD     password for the ledger_read_app login user
#   DATABASE_URL  (or PGHOST/PGUSER/… libpq vars) pointing at a role that can
#                 CREATE ROLE + GRANT (the migration owner / a superuser). This
#                 admin connection is used ONCE for activation; the running
#                 services must NOT use it.
#
# Optional env:
#   LEDGER_ENGINE_ROLE   login user name (default: ledger_engine_app)
#   LEDGER_READ_ROLE     login user name (default: ledger_read_app)
#   PSQL                 psql binary (default: psql)
#   DRY_RUN=1            print the SQL that WOULD run, do not execute.
# =============================================================================

set -eu

PSQL="${PSQL:-psql}"
ENGINE_ROLE="${LEDGER_ENGINE_ROLE:-ledger_engine_app}"
READ_ROLE="${LEDGER_READ_ROLE:-ledger_read_app}"
WRITER_GROUP="borjie_ledger_writer"
READER_GROUP="borjie_ledger_reader"

# --- Preconditions ----------------------------------------------------------

fail() {
  printf 'activate-ledger-roles: ERROR: %s\n' "$1" >&2
  exit 1
}

if [ -z "${LEDGER_ENGINE_PASSWORD:-}" ]; then
  fail "LEDGER_ENGINE_PASSWORD is not set (read from env; never hardcode)."
fi
if [ -z "${LEDGER_READ_PASSWORD:-}" ]; then
  fail "LEDGER_READ_PASSWORD is not set (read from env; never hardcode)."
fi
if [ -z "${DATABASE_URL:-}" ] && [ -z "${PGHOST:-}" ]; then
  fail "DATABASE_URL (or PGHOST/PGUSER/...) must point at an admin connection that can CREATE ROLE + GRANT."
fi
if ! command -v "$PSQL" >/dev/null 2>&1; then
  fail "psql binary '$PSQL' not found on PATH (override with PSQL=...)."
fi

# Reject role names that are not plain identifiers so they cannot break out of
# the quoted-identifier context below (defence in depth — operators only).
case "$ENGINE_ROLE" in
  *[!a-zA-Z0-9_]*) fail "LEDGER_ENGINE_ROLE '$ENGINE_ROLE' is not a plain identifier." ;;
esac
case "$READ_ROLE" in
  *[!a-zA-Z0-9_]*) fail "LEDGER_READ_ROLE '$READ_ROLE' is not a plain identifier." ;;
esac

# Build the connection argument list. Prefer DATABASE_URL; else rely on libpq
# PG* env vars already in the environment.
if [ -n "${DATABASE_URL:-}" ]; then
  set -- "$DATABASE_URL"
else
  set --
fi

# --- SQL generation ---------------------------------------------------------
#
# The passwords are passed to psql as :'pw_engine' / :'pw_read' VARIABLES via
# --set, never interpolated into the SQL text here, so they are NEVER written
# to disk, command history, or this script's stdout. psql quotes the
# :'name' form safely. CREATE ROLE is wrapped in a duplicate_object-swallowing
# DO block; ALTER ROLE then (re)applies the password + LOGIN so the script is
# idempotent and doubles as a password-rotation tool.

read_sql() {
  cat <<SQL
\set ON_ERROR_STOP on

-- §1 — Verify the prerequisite group roles from migration 0275 exist. If they
--      do not, 0275 has NOT been applied; abort rather than create login users
--      that grant nothing.
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${WRITER_GROUP}') THEN
    RAISE EXCEPTION 'prerequisite role ${WRITER_GROUP} missing — apply migration 0275 first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${READER_GROUP}') THEN
    RAISE EXCEPTION 'prerequisite role ${READER_GROUP} missing — apply migration 0275 first';
  END IF;
END
\$\$;

-- §2 — Engine login user (write path). Idempotent create + (re)set password.
DO \$\$
BEGIN
  CREATE ROLE ${ENGINE_ROLE} LOGIN;
EXCEPTION WHEN duplicate_object THEN
  NULL; -- already exists; password (re)set below.
END
\$\$;
ALTER ROLE ${ENGINE_ROLE} WITH LOGIN PASSWORD :'pw_engine';
GRANT ${WRITER_GROUP} TO ${ENGINE_ROLE};

-- §3 — Read login user (read path). Idempotent create + (re)set password.
DO \$\$
BEGIN
  CREATE ROLE ${READ_ROLE} LOGIN;
EXCEPTION WHEN duplicate_object THEN
  NULL;
END
\$\$;
ALTER ROLE ${READ_ROLE} WITH LOGIN PASSWORD :'pw_read';
GRANT ${READER_GROUP} TO ${READ_ROLE};

-- §4 — Echo the resulting membership (no secrets) for the operator's log.
SELECT r.rolname AS login_user,
       g.rolname AS granted_group
  FROM pg_auth_members m
  JOIN pg_roles r ON r.oid = m.member
  JOIN pg_roles g ON g.oid = m.roleid
 WHERE r.rolname IN ('${ENGINE_ROLE}', '${READ_ROLE}')
 ORDER BY r.rolname;
SQL
}

# --- Execute ----------------------------------------------------------------

if [ "${DRY_RUN:-0}" = "1" ]; then
  printf 'activate-ledger-roles: DRY_RUN=1 — SQL that WOULD run (passwords are passed as bound psql variables, NOT shown):\n\n'
  read_sql
  printf '\n(DRY_RUN — nothing executed.)\n'
else
  printf 'activate-ledger-roles: creating login users %s + %s and granting group roles...\n' \
    "$ENGINE_ROLE" "$READ_ROLE"
  # Passwords flow ONLY through --set bound variables. Nothing secret is echoed.
  read_sql | "$PSQL" "$@" \
    --no-psqlrc \
    --set=pw_engine="$LEDGER_ENGINE_PASSWORD" \
    --set=pw_read="$LEDGER_READ_PASSWORD" \
    --file=-
  printf 'activate-ledger-roles: roles activated.\n'
fi

# --- DATABASE_URL repoint instructions (printed; not auto-applied) ----------

cat <<'INSTRUCTIONS'

-----------------------------------------------------------------------------
NEXT: repoint the payments-ledger connection strings (operator / IaC action;
this script does NOT mutate service config).

  payments-ledger ENGINE (write path)  — the process that calls
  LedgerService.post() — must connect AS the engine login user:

      DATABASE_URL=postgres://ledger_engine_app:<engine-secret>@<host>:5432/<db>

  This role can INSERT into ledger_entries/settlements/disbursements and
  INSERT+UPDATE payment_intents/accounts. It has NO DELETE / NO TRUNCATE on the
  immutable double-entry tables — the database now ENFORCES append-only.

  Ledger READ path (ledger-api / brain reads / replica) must connect AS the
  read login user:

      LEDGER_READ_DATABASE_URL=postgres://ledger_read_app:<read-secret>@<host>:5432/<db>

  This role is SELECT-only on the money tables.

REMINDER:
  * FORCE RLS (migration 0160) still applies to BOTH roles — neither is the
    table owner and neither has BYPASSRLS, so app.current_tenant_id tenant
    isolation is unaffected. Grants gate the verbs; RLS gates the rows.
  * Ensure NO other service authenticates with the table-owner / superuser role
    against these tables — the owner bypasses these grants.
  * Roll the passwords by re-running this script with new *_PASSWORD env values
    (ALTER ROLE … PASSWORD is idempotent).
-----------------------------------------------------------------------------
INSTRUCTIONS
