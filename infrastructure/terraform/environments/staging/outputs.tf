# =============================================================================
# Staging Environment - Outputs
# =============================================================================

output "vpc_id" {
  value = module.vpc.vpc_id
}

output "api_url" {
  value       = module.ecs.api_url
  description = "API base URL"
}

output "alb_dns_name" {
  value = module.ecs.alb_dns_name
}

output "rds_endpoint" {
  value     = module.rds.endpoint
  sensitive = true
}

output "redis_endpoint" {
  value = module.redis.endpoint
}
