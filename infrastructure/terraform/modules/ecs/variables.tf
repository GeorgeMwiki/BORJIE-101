# =============================================================================
# ECS Module - Input Variables
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

variable "public_subnet_ids" {
  description = "Public subnet IDs for ALB"
  type        = list(string)
}

variable "private_subnet_ids" {
  description = "Private subnet IDs for ECS tasks"
  type        = list(string)
}

variable "database_url" {
  description = "PostgreSQL connection string"
  type        = string
  sensitive   = true
}

variable "redis_url" {
  description = "Redis connection URL"
  type        = string
  sensitive   = true
}

variable "api_image" {
  description = "Docker image for API gateway"
  type        = string
}

variable "api_cpu" {
  description = "CPU units for API task"
  type        = number
  default     = 256
}

variable "api_memory" {
  description = "Memory in MB for API task"
  type        = number
  default     = 512
}

variable "api_desired_count" {
  description = "Desired number of API tasks"
  type        = number
  default     = 1
}

variable "api_port" {
  description = "Port the API listens on"
  type        = number
  default     = 4000
}

variable "enable_container_insights" {
  description = "Enable CloudWatch Container Insights"
  type        = bool
  default     = true
}

# -----------------------------------------------------------------------------
# App Services (estate-manager, customer-app, owner-portal, admin-portal)
# -----------------------------------------------------------------------------
variable "app_services" {
  description = "Map of app services to deploy. Key = service name."
  type = map(object({
    image         = string
    cpu           = number
    memory        = number
    port          = number
    desired_count = number
    path_pattern  = string
  }))
  default = {}
}
