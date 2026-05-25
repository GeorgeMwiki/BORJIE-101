# =============================================================================
# Redis Sentinel config — rendered per-node by entrypoint-sentinel.sh
# =============================================================================
# Vars consumed:
#   SENTINEL_PORT                (default 26379)
#   REDIS_SENTINEL_NAME          (logical master name, e.g. borjie-master)
#   REDIS_PRIMARY_HOST           (e.g. redis-primary)
#   REDIS_PRIMARY_PORT           (default 6379)
#   REDIS_SENTINEL_QUORUM        (default 2 — needs majority of 3)
#   REDIS_PASSWORD               (master auth — also requirepass on primary/replica)
#   SENTINEL_ANNOUNCE_HOST       (override for cross-host announce; defaults to
#                                 container hostname which works inside the
#                                 docker bridge network)
# =============================================================================

port ${SENTINEL_PORT}

# Required for routable Sentinel-to-Sentinel + Sentinel-to-client traffic across
# docker networks. announce-hostnames=yes lets us use docker service names.
sentinel resolve-hostnames yes
sentinel announce-hostnames yes
sentinel announce-ip ${SENTINEL_ANNOUNCE_HOST}
sentinel announce-port ${SENTINEL_PORT}

# Authenticate to the master & replicas
sentinel auth-pass ${REDIS_SENTINEL_NAME} ${REDIS_PASSWORD}
sentinel auth-user ${REDIS_SENTINEL_NAME} default

# Sentinel itself is password-protected
requirepass ${REDIS_PASSWORD}

# -----------------------------------------------------------------------------
# Master monitoring
# -----------------------------------------------------------------------------
# sentinel monitor <name> <ip> <port> <quorum>
sentinel monitor ${REDIS_SENTINEL_NAME} ${REDIS_PRIMARY_HOST} ${REDIS_PRIMARY_PORT} ${REDIS_SENTINEL_QUORUM}

# How long before a master is considered SDOWN (subjectively down)
sentinel down-after-milliseconds ${REDIS_SENTINEL_NAME} 5000

# How many replicas can be re-synced in parallel during a failover
sentinel parallel-syncs ${REDIS_SENTINEL_NAME} 1

# Failover timeout — election retry interval (also bounds RTO)
sentinel failover-timeout ${REDIS_SENTINEL_NAME} 10000

# Deny commands that would reset cluster state from clients
sentinel deny-scripts-reconfig yes

# Logging
logfile ""
loglevel notice

# Working dir (sentinel state file: sentinel.conf is REWRITTEN by sentinel)
dir /tmp
