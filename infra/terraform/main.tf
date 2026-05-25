# BORJIE Infrastructure
# Terraform configuration for multi-environment deployment

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.45"
    }
  }

  # Backend configuration - uncomment and configure for remote state
  # backend "s3" {
  #   bucket         = "borjie-terraform-state"
  #   key            = "infrastructure/terraform.tfstate"
  #   region         = "eu-west-1"
  #   encrypt        = true
  #   dynamodb_table = "borjie-terraform-locks"
  # }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "BORJIE"
      Environment = var.environment
      ManagedBy   = "Terraform"
    }
  }
}

# Variables
variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "eu-west-1"
}

variable "environment" {
  description = "Deployment environment"
  type        = string
  default     = "development"
}

variable "project_name" {
  description = "Project name"
  type        = string
  default     = "borjie"
}

# Outputs
output "environment" {
  value = var.environment
}

# TODO: Add infrastructure modules
# - VPC and networking
# - ECS/EKS for container orchestration
# - RDS PostgreSQL
# - ElastiCache Redis
# - S3 buckets for file storage
# - CloudFront distributions
# - Route53 DNS
# - ACM certificates
# - Secrets Manager
# - CloudWatch logging and monitoring
