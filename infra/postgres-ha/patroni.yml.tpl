# =============================================================================
# Patroni node config — rendered per-node by infra/postgres-ha/entrypoint.sh
# =============================================================================
# Vars consumed (all REQUIRED, sourced from .env.production):
#   PATRONI_NAME, PATRONI_SCOPE, PATRONI_NAMESPACE
#   PATRONI_RESTAPI_LISTEN, PATRONI_RESTAPI_CONNECT_ADDRESS
#   PATRONI_POSTGRESQL_LISTEN, PATRONI_POSTGRESQL_CONNECT_ADDRESS
#   PATRONI_POSTGRESQL_DATA_DIR
#   PGHA_ETCD_HOSTS  (e.g. etcd-1:2379,etcd-2:2379,etcd-3:2379)
#   PATRONI_SUPERUSER_PASSWORD, PATRONI_REPLICATION_PASSWORD,
#   PATRONI_REWIND_PASSWORD
#   WAL_S3_BUCKET, WAL_S3_PREFIX (e.g. borjie-prod/wal),
#   WAL_ENCRYPTION_KEY (KMS key arn or alias)
#   AWS_REGION
#
# Failover targets:
#   RTO ≤ 30s  (ttl=30, loop_wait=10, retry_timeout=10)
#   RPO ≤ 5s   (synchronous_mode=on with maximum_lag_on_failover guard)
# =============================================================================

scope: ${PATRONI_SCOPE}
namespace: ${PATRONI_NAMESPACE}
name: ${PATRONI_NAME}

restapi:
  listen: ${PATRONI_RESTAPI_LISTEN}
  connect_address: ${PATRONI_RESTAPI_CONNECT_ADDRESS}

etcd3:
  hosts: ${PGHA_ETCD_HOSTS}
  protocol: http

bootstrap:
  dcs:
    ttl: 30
    loop_wait: 10
    retry_timeout: 10
    maximum_lag_on_failover: 1048576   # 1 MiB — cap RPO at ~5s of WAL
    synchronous_mode: true
    synchronous_mode_strict: false
    postgresql:
      use_pg_rewind: true
      use_slots: true
      parameters:
        wal_level: replica
        hot_standby: "on"
        max_wal_senders: 10
        max_replication_slots: 10
        wal_log_hints: "on"
        archive_mode: "on"
        archive_command: 'envdir /run/etc/wal-env wal-g wal-push %p'
        archive_timeout: 60
        max_connections: 200
        shared_buffers: 512MB
        effective_cache_size: 2GB
        work_mem: 16MB
        maintenance_work_mem: 128MB
        synchronous_commit: "on"
        log_min_duration_statement: 500
        log_connections: "on"
        log_disconnections: "on"
        log_replication_commands: "on"
  initdb:
    - encoding: UTF8
    - data-checksums
  users:
    admin:
      password: ${PATRONI_SUPERUSER_PASSWORD}
      options:
        - createrole
        - createdb
  pg_hba:
    - host replication replicator 0.0.0.0/0 scram-sha-256
    - host all all 0.0.0.0/0 scram-sha-256

postgresql:
  listen: ${PATRONI_POSTGRESQL_LISTEN}
  connect_address: ${PATRONI_POSTGRESQL_CONNECT_ADDRESS}
  data_dir: ${PATRONI_POSTGRESQL_DATA_DIR}
  bin_dir: /usr/lib/postgresql/16/bin
  pgpass: /tmp/pgpass
  authentication:
    superuser:
      username: postgres
      password: ${PATRONI_SUPERUSER_PASSWORD}
    replication:
      username: replicator
      password: ${PATRONI_REPLICATION_PASSWORD}
    rewind:
      username: rewind_user
      password: ${PATRONI_REWIND_PASSWORD}
  parameters:
    unix_socket_directories: '/var/run/postgresql'
  create_replica_methods:
    - wal_g
    - basebackup
  wal_g:
    command: wal-g backup-fetch ${PATRONI_POSTGRESQL_DATA_DIR} LATEST
    no_params: true
    no_master: 1
  basebackup:
    max-rate: '100M'
    checkpoint: fast

tags:
  nofailover: false
  noloadbalance: false
  clonefrom: false
  nosync: false

watchdog:
  mode: off          # disable on docker; enable in k8s if /dev/watchdog is mounted
