# =============================================================================
# BORJIE — Production environment (Phase D agent D9 additive layer)
# =============================================================================
# Lives alongside the existing flat `infra/terraform/*.tf` configuration; this
# file ONLY introduces the optional multi-region module behind a feature
# flag so the live single-region deployment is unaffected.
#
# Enable the module by running:
#   terraform apply -var enable_multi_region=true ...
#
# Until then, `count = 0` keeps every resource in the module out of state.
# =============================================================================

terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.45"
    }
  }
}

# -----------------------------------------------------------------------------
# Provider aliases for primary + secondary regions
# -----------------------------------------------------------------------------
provider "aws" {
  alias  = "primary"
  region = var.primary_region
}

provider "aws" {
  alias  = "secondary"
  region = var.secondary_region
}

# -----------------------------------------------------------------------------
# Variables — additive only.
# -----------------------------------------------------------------------------
variable "enable_multi_region" {
  description = "When true, stand up the warm-standby region (RDS replica + S3 CRR + Route 53 failover)."
  type        = bool
  default     = false
}

variable "primary_region" {
  description = "Primary AWS region."
  type        = string
  default     = "eu-west-1"
}

variable "secondary_region" {
  description = "Secondary (failover) AWS region."
  type        = string
  default     = "us-east-1"
}

variable "primary_rds_arn" {
  description = "ARN of the existing primary RDS instance (consumed by the multi-region module when enabled)."
  type        = string
  default     = ""
}

variable "primary_s3_bucket_id" {
  description = "ID of the existing primary S3 bucket (consumed by the multi-region module when enabled)."
  type        = string
  default     = ""
}

variable "primary_dns_name" {
  description = "Fully-qualified DNS name of the application endpoint."
  type        = string
  default     = ""
}

variable "route53_zone_id" {
  description = "Route 53 hosted-zone ID."
  type        = string
  default     = ""
}

variable "primary_health_check_fqdn" {
  description = "FQDN exposed by the primary application for health checks."
  type        = string
  default     = ""
}

# -----------------------------------------------------------------------------
# Multi-region module (gated)
# -----------------------------------------------------------------------------
module "multi_region" {
  count  = var.enable_multi_region ? 1 : 0
  source = "../../modules/multi-region"
  providers = {
    aws.primary   = aws.primary
    aws.secondary = aws.secondary
  }
  project_name              = "borjie"
  environment               = "production"
  primary_region            = var.primary_region
  secondary_region          = var.secondary_region
  primary_rds_arn           = var.primary_rds_arn
  primary_s3_bucket_id      = var.primary_s3_bucket_id
  primary_dns_name          = var.primary_dns_name
  route53_zone_id           = var.route53_zone_id
  primary_health_check_fqdn = var.primary_health_check_fqdn
}

output "multi_region_enabled" {
  value       = var.enable_multi_region
  description = "Whether the warm-standby region is currently active."
}
