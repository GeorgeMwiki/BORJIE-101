# =============================================================================
# Redis Module - Outputs
# =============================================================================

output "endpoint" {
  description = "Redis primary endpoint (host:port)"
  value       = "${aws_elasticache_replication_group.main.primary_endpoint_address}:${aws_elasticache_replication_group.main.port}"
}

output "primary_endpoint_address" {
  description = "Redis primary endpoint address"
  value       = aws_elasticache_replication_group.main.primary_endpoint_address
}

output "port" {
  description = "Redis port"
  value       = aws_elasticache_replication_group.main.port
}

output "connection_string" {
  description = "Redis connection URL"
  value       = "redis://${aws_elasticache_replication_group.main.primary_endpoint_address}:${aws_elasticache_replication_group.main.port}"
  sensitive   = true
}

output "security_group_id" {
  description = "Redis security group ID"
  value       = aws_security_group.redis.id
}
