# =============================================================================
# BORJIE Infrastructure - Input Variables
# =============================================================================

# -----------------------------------------------------------------------------
# General
# -----------------------------------------------------------------------------
variable "project_name" {
  description = "Project name used for resource naming"
  type        = string
}

variable "environment" {
  description = "Deployment environment (staging, production)"
  type        = string
}

variable "aws_region" {
  description = "AWS region for resources"
  type        = string
  default     = "eu-west-1"
}

# -----------------------------------------------------------------------------
# VPC / Networking
# -----------------------------------------------------------------------------
variable "vpc_cidr" {
  description = "CIDR block for VPC"
  type        = string
}

variable "availability_zones" {
  description = "List of availability zones"
  type        = list(string)
}

variable "public_subnet_cidrs" {
  description = "CIDR blocks for public subnets"
  type        = list(string)
}

variable "private_subnet_cidrs" {
  description = "CIDR blocks for private subnets"
  type        = list(string)
}

variable "enable_nat_gateway" {
  description = "Enable NAT gateway for private subnet internet access"
  type        = bool
  default     = true
}

variable "single_nat_gateway" {
  description = "Use single NAT gateway (cost savings) vs one per AZ"
  type        = bool
  default     = false
}

# -----------------------------------------------------------------------------
# RDS
# -----------------------------------------------------------------------------
variable "rds_instance_class" {
  description = "RDS instance class"
  type        = string
}

variable "rds_allocated_storage" {
  description = "RDS allocated storage in GB"
  type        = number
}

variable "rds_database_name" {
  description = "Name of the database"
  type        = string
}

variable "rds_username" {
  description = "Master username for RDS"
  type        = string
  sensitive   = true
}

variable "rds_password" {
  description = "Master password for RDS"
  type        = string
  sensitive   = true
}

variable "rds_multi_az" {
  description = "Enable Multi-AZ deployment for RDS"
  type        = bool
  default     = false
}

# -----------------------------------------------------------------------------
# Redis
# -----------------------------------------------------------------------------
variable "redis_node_type" {
  description = "ElastiCache node type"
  type        = string
}

variable "redis_num_cache_clusters" {
  description = "Number of cache clusters (replicas)"
  type        = number
  default     = 1
}

# -----------------------------------------------------------------------------
# ECS
# -----------------------------------------------------------------------------
variable "api_image" {
  description = "Docker image for API service"
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

variable "enable_container_insights" {
  description = "Enable CloudWatch Container Insights"
  type        = bool
  default     = true
}

# -----------------------------------------------------------------------------
# App Services
# -----------------------------------------------------------------------------
variable "app_services" {
  description = "Map of app services (estate-manager, customer-app, owner-portal, admin-portal)"
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

# -----------------------------------------------------------------------------
# S3
# -----------------------------------------------------------------------------
variable "s3_cors_allowed_origins" {
  description = "CORS allowed origins for S3 bucket"
  type        = list(string)
  default     = ["*"]
}

# -----------------------------------------------------------------------------
# ECR
# -----------------------------------------------------------------------------
variable "ecr_repository_names" {
  description = "List of ECR repository names to create"
  type        = list(string)
  default = [
    "api-gateway",
    "customer-app",
    "estate-manager-app",
    "owner-portal",
    "admin-portal",
    "payments",
    "notifications",
    "reports"
  ]
}
