# =============================================================================
# Redis replica config — HA topology
# =============================================================================
# Vars consumed:
#   REDIS_PRIMARY_HOST, REDIS_PRIMARY_PORT
#   REDIS_REPLICA_ANNOUNCE_HOST (this replica's hostname inside the network)
# Password fields (--requirepass, --masterauth) come from CLI in compose.
# =============================================================================

port 6379
bind 0.0.0.0
protected-mode yes

replicaof ${REDIS_PRIMARY_HOST} ${REDIS_PRIMARY_PORT}
replica-read-only yes
replica-serve-stale-data no
replica-announce-ip ${REDIS_REPLICA_ANNOUNCE_HOST}
replica-announce-port 6379

# Persistence
appendonly yes
appendfsync everysec
save 60 1000

maxmemory 512mb
maxmemory-policy allkeys-lru

loglevel notice
logfile ""
