# =============================================================================
# BORJIE - Staging Environment
# =============================================================================
# Usage: terraform init -backend-config=backend.hcl && terraform apply -var-file=staging.tfvars
# =============================================================================

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    # Configure via: terraform init -backend-config=backend.hcl
    # bucket         = "borjie-terraform-state"
    # key            = "staging/terraform.tfstate"
    # region         = "eu-west-1"
    # encrypt        = true
    # dynamodb_table = "borjie-terraform-locks"
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "BORJIE"
      Environment = "staging"
      ManagedBy   = "Terraform"
    }
  }
}

# -----------------------------------------------------------------------------
# Modules
# -----------------------------------------------------------------------------
module "vpc" {
  source = "../../modules/vpc"

  project_name       = var.project_name
  environment        = var.environment
  vpc_cidr           = var.vpc_cidr
  azs                = var.availability_zones
  public_subnets     = var.public_subnet_cidrs
  private_subnets    = var.private_subnet_cidrs
  enable_nat_gateway = var.enable_nat_gateway
  single_nat_gateway = var.single_nat_gateway
}

module "rds" {
  source = "../../modules/rds"

  project_name       = var.project_name
  environment        = var.environment
  vpc_id             = module.vpc.vpc_id
  vpc_cidr           = module.vpc.vpc_cidr
  private_subnet_ids = module.vpc.private_subnet_ids
  instance_class     = var.rds_instance_class
  allocated_storage  = var.rds_allocated_storage
  database_name     = var.rds_database_name
  database_username = var.rds_username
  database_password = var.rds_password
  multi_az          = var.rds_multi_az
}

module "redis" {
  source = "../../modules/redis"

  project_name       = var.project_name
  environment        = var.environment
  vpc_id             = module.vpc.vpc_id
  private_subnet_ids = module.vpc.private_subnet_ids
  node_type          = var.redis_node_type
  num_cache_clusters = var.redis_num_cache_clusters
}

module "ecs" {
  source = "../../modules/ecs"

  project_name            = var.project_name
  environment             = var.environment
  vpc_id                  = module.vpc.vpc_id
  public_subnet_ids       = module.vpc.public_subnet_ids
  private_subnet_ids      = module.vpc.private_subnet_ids
  database_url            = module.rds.connection_string
  redis_url               = module.redis.connection_string
  api_image               = var.api_image
  api_cpu                 = var.api_cpu
  api_memory              = var.api_memory
  api_desired_count       = var.api_desired_count
  enable_container_insights = var.enable_container_insights
  app_services            = var.app_services
}
