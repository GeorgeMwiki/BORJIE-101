# =============================================================================
# BORJIE Infrastructure - Output Values
# =============================================================================

# -----------------------------------------------------------------------------
# VPC Outputs
# -----------------------------------------------------------------------------
output "vpc_id" {
  description = "VPC ID"
  value       = module.vpc.vpc_id
}

output "public_subnet_ids" {
  description = "Public subnet IDs"
  value       = module.vpc.public_subnet_ids
}

output "private_subnet_ids" {
  description = "Private subnet IDs"
  value       = module.vpc.private_subnet_ids
}

# -----------------------------------------------------------------------------
# RDS Outputs
# -----------------------------------------------------------------------------
output "rds_endpoint" {
  description = "RDS instance endpoint"
  value       = module.rds.endpoint
  sensitive   = true
}

output "rds_connection_string" {
  description = "PostgreSQL connection string (without password)"
  value       = module.rds.connection_string
  sensitive   = true
}

# -----------------------------------------------------------------------------
# Redis Outputs
# -----------------------------------------------------------------------------
output "redis_endpoint" {
  description = "Redis cluster endpoint"
  value       = module.redis.endpoint
}

output "redis_connection_string" {
  description = "Redis connection URL"
  value       = module.redis.connection_string
  sensitive   = true
}

# -----------------------------------------------------------------------------
# ECS Outputs
# -----------------------------------------------------------------------------
output "ecs_cluster_name" {
  description = "ECS cluster name"
  value       = module.ecs.cluster_name
}

output "alb_dns_name" {
  description = "ALB DNS name for API"
  value       = module.ecs.alb_dns_name
}

output "api_url" {
  description = "API base URL"
  value       = module.ecs.api_url
}

# -----------------------------------------------------------------------------
# S3 Outputs
# -----------------------------------------------------------------------------
output "s3_bucket_id" {
  description = "S3 documents bucket ID"
  value       = module.s3.bucket_id
}

output "s3_bucket_arn" {
  description = "S3 documents bucket ARN"
  value       = module.s3.bucket_arn
}

# -----------------------------------------------------------------------------
# ECR Outputs
# -----------------------------------------------------------------------------
output "ecr_registry_url" {
  description = "ECR registry URL"
  value       = module.ecr.registry_url
}

output "ecr_repository_urls" {
  description = "ECR repository URLs"
  value       = module.ecr.repository_urls
}
