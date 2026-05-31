# =============================================================================
# Redis Module - Input Variables
# =============================================================================

variable "project_name" {
  description = "Project name for resource naming"
  type        = string
}

variable "environment" {
  description = "Environment name"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID"
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnet IDs for ElastiCache"
  type        = list(string)
}

variable "node_type" {
  description = "ElastiCache node type"
  type        = string
}

variable "num_cache_clusters" {
  description = "Number of cache clusters (replicas)"
  type        = number
  default     = 1
}

variable "engine_version" {
  description = "Redis engine version"
  type        = string
  default     = "7.0"
}

variable "auth_token" {
  description = <<-EOT
    Redis AUTH token (password). Required for password auth on the
    replication group; must be 16-128 printable chars. Source it from
    AWS Secrets Manager / a random_password resource, never hardcode.
    Leave null to enable TLS-in-transit without password auth.
  EOT
  type        = string
  default     = null
  sensitive   = true

  validation {
    condition     = var.auth_token == null || length(var.auth_token) >= 16
    error_message = "Redis auth_token must be at least 16 characters."
  }
}
