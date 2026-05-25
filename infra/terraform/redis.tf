# =============================================================================
# BORJIE — ElastiCache Redis
# =============================================================================
# Used for:
#   - BullMQ queues (notifications, reports, outbox)
#   - Idempotency keys (webhooks, payments)
#   - OTP short-lived storage (identity service)
#   - Rate limit counters (api-gateway)
#
# Single-node cache.t4g.micro by default; override via tfvars for staging/prod.
# =============================================================================

variable "redis_node_type" {
  description = "ElastiCache node type (defaults to burstable t4g.micro)."
  type        = string
  default     = "cache.t4g.micro"
}

variable "redis_engine_version" {
  description = "Redis engine version."
  type        = string
  default     = "7.1"
}

variable "redis_num_cache_nodes" {
  description = "Replica count (1 = single-node, no failover)."
  type        = number
  default     = 1
}

data "aws_subnets" "redis" {
  filter {
    name   = "tag:Tier"
    values = ["private"]
  }
  filter {
    name   = "tag:Project"
    values = [var.project_name]
  }
}

data "aws_security_group" "redis" {
  name = "${var.project_name}-${var.environment}-redis"
}

resource "aws_elasticache_subnet_group" "redis" {
  name       = "${var.project_name}-${var.environment}-redis"
  subnet_ids = data.aws_subnets.redis.ids

  tags = {
    Component = "redis"
  }
}

resource "aws_elasticache_cluster" "redis" {
  cluster_id           = "${var.project_name}-${var.environment}-redis"
  engine               = "redis"
  engine_version       = var.redis_engine_version
  node_type            = var.redis_node_type
  num_cache_nodes      = var.redis_num_cache_nodes
  parameter_group_name = "default.redis7"
  port                 = 6379
  subnet_group_name    = aws_elasticache_subnet_group.redis.name
  security_group_ids   = [data.aws_security_group.redis.id]
  apply_immediately    = false

  # TLS in-transit handled at the replication-group level for multi-AZ;
  # single-node dev / staging uses the built-in port 6379 only.

  tags = {
    Component = "redis"
  }
}

output "redis_endpoint" {
  value       = aws_elasticache_cluster.redis.cache_nodes[0].address
  description = "Redis cluster endpoint for REDIS_URL assembly."
}

output "redis_port" {
  value       = aws_elasticache_cluster.redis.cache_nodes[0].port
  description = "Redis port."
}
