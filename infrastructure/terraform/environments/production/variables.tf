# =============================================================================
# Staging Environment - Variables
# =============================================================================

variable "project_name" {
  description = "Project name"
  type        = string
}

variable "environment" {
  description = "Environment name"
  type        = string
}

variable "aws_region" {
  description = "AWS region"
  type        = string
}

variable "vpc_cidr" {
  description = "VPC CIDR"
  type        = string
}

variable "availability_zones" {
  description = "Availability zones"
  type        = list(string)
}

variable "public_subnet_cidrs" {
  description = "Public subnet CIDRs"
  type        = list(string)
}

variable "private_subnet_cidrs" {
  description = "Private subnet CIDRs"
  type        = list(string)
}

variable "enable_nat_gateway" {
  description = "Enable NAT gateway"
  type        = bool
}

variable "single_nat_gateway" {
  description = "Use single NAT gateway"
  type        = bool
}

variable "rds_instance_class" {
  description = "RDS instance class"
  type        = string
}

variable "rds_allocated_storage" {
  description = "RDS storage GB"
  type        = number
}

variable "rds_database_name" {
  description = "Database name"
  type        = string
}

variable "rds_username" {
  description = "RDS username"
  type        = string
  sensitive   = true
}

variable "rds_password" {
  description = "RDS password"
  type        = string
  sensitive   = true
}

variable "rds_multi_az" {
  description = "RDS Multi-AZ"
  type        = bool
}

variable "redis_node_type" {
  description = "Redis node type"
  type        = string
}

variable "redis_num_cache_clusters" {
  description = "Redis cluster count"
  type        = number
}

variable "api_image" {
  description = "API Docker image"
  type        = string
}

variable "api_cpu" {
  description = "API CPU units"
  type        = number
}

variable "api_memory" {
  description = "API memory MB"
  type        = number
}

variable "api_desired_count" {
  description = "API task count"
  type        = number
}

variable "enable_container_insights" {
  description = "Container Insights"
  type        = bool
}
