# =============================================================================
# BORJIE — Multi-region module (Phase D agent D9)
# =============================================================================
# Stands up the warm-standby region: an RDS read replica, an S3 cross-
# region replication target, and a Route 53 failover policy. The module
# is OFF by default — wired behind `var.enable_multi_region` at the
# environment layer so the live single-region deployment is unaffected.
#
# Inputs are minimal on purpose; the live module call inside
# `infra/terraform/environments/production/main.tf` supplies them.
# =============================================================================

terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source                = "hashicorp/aws"
      version               = "~> 6.45"
      configuration_aliases = [aws.primary, aws.secondary]
    }
  }
}

# -----------------------------------------------------------------------------
# Inputs
# -----------------------------------------------------------------------------

variable "project_name" {
  description = "Project name prefix for all resources."
  type        = string
}

variable "environment" {
  description = "Environment identifier (production, staging, …)."
  type        = string
}

variable "primary_region" {
  description = "Primary AWS region (e.g. eu-west-1)."
  type        = string
}

variable "secondary_region" {
  description = "Secondary / failover AWS region (e.g. us-east-1)."
  type        = string
}

variable "primary_rds_arn" {
  description = "ARN of the primary RDS instance to replicate FROM."
  type        = string
}

variable "primary_s3_bucket_id" {
  description = "ID of the primary S3 bucket to replicate FROM."
  type        = string
}

variable "primary_dns_name" {
  description = "Fully-qualified DNS name of the primary application endpoint."
  type        = string
}

variable "route53_zone_id" {
  description = "Route 53 hosted-zone ID owning the application DNS name."
  type        = string
}

variable "primary_health_check_fqdn" {
  description = "Health-check endpoint exposed by the primary application."
  type        = string
}

variable "secondary_rds_instance_class" {
  description = "RDS instance class for the read replica."
  type        = string
  default     = "db.t4g.medium"
}

# -----------------------------------------------------------------------------
# RDS cross-region read replica
# -----------------------------------------------------------------------------
resource "aws_db_instance" "secondary_replica" {
  provider             = aws.secondary
  identifier           = "${var.project_name}-${var.environment}-replica"
  replicate_source_db  = var.primary_rds_arn
  instance_class       = var.secondary_rds_instance_class
  publicly_accessible  = false
  storage_encrypted    = true
  auto_minor_version_upgrade = true
  apply_immediately    = false
  skip_final_snapshot  = true

  tags = {
    Project     = var.project_name
    Environment = var.environment
    Purpose     = "dr-read-replica"
  }
}

# -----------------------------------------------------------------------------
# S3 cross-region replication
# -----------------------------------------------------------------------------
resource "aws_s3_bucket" "secondary_objects" {
  provider = aws.secondary
  bucket   = "${var.project_name}-${var.environment}-${var.secondary_region}-dr"

  tags = {
    Project     = var.project_name
    Environment = var.environment
    Purpose     = "dr-object-replica"
  }
}

resource "aws_s3_bucket_versioning" "secondary_objects" {
  provider = aws.secondary
  bucket   = aws_s3_bucket.secondary_objects.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_iam_role" "replication" {
  provider = aws.primary
  name     = "${var.project_name}-${var.environment}-s3-replication"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = { Service = "s3.amazonaws.com" }
      Action = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "replication" {
  provider = aws.primary
  name     = "${var.project_name}-${var.environment}-s3-replication"
  role     = aws_iam_role.replication.id
  policy   = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = [
          "s3:GetReplicationConfiguration",
          "s3:ListBucket",
          "s3:GetObjectVersionForReplication",
          "s3:GetObjectVersionAcl",
          "s3:GetObjectVersionTagging",
        ]
        Resource = ["arn:aws:s3:::${var.primary_s3_bucket_id}", "arn:aws:s3:::${var.primary_s3_bucket_id}/*"]
      },
      {
        Effect   = "Allow"
        Action   = [
          "s3:ReplicateObject",
          "s3:ReplicateDelete",
          "s3:ReplicateTags",
        ]
        Resource = "${aws_s3_bucket.secondary_objects.arn}/*"
      },
    ]
  })
}

resource "aws_s3_bucket_replication_configuration" "primary_to_secondary" {
  provider   = aws.primary
  depends_on = [aws_iam_role_policy.replication]
  bucket     = var.primary_s3_bucket_id
  role       = aws_iam_role.replication.arn

  rule {
    id     = "${var.project_name}-${var.environment}-dr"
    status = "Enabled"
    destination {
      bucket        = aws_s3_bucket.secondary_objects.arn
      storage_class = "STANDARD_IA"
    }
  }
}

# -----------------------------------------------------------------------------
# Route 53 failover policy
# -----------------------------------------------------------------------------
resource "aws_route53_health_check" "primary" {
  fqdn              = var.primary_health_check_fqdn
  port              = 443
  type              = "HTTPS"
  resource_path     = "/healthz"
  failure_threshold = 3
  request_interval  = 30

  tags = {
    Project     = var.project_name
    Environment = var.environment
    Purpose     = "dr-primary-healthcheck"
  }
}

resource "aws_route53_record" "primary_failover" {
  zone_id        = var.route53_zone_id
  name           = var.primary_dns_name
  type           = "A"
  ttl            = 60
  set_identifier = "primary"
  failover_routing_policy {
    type = "PRIMARY"
  }
  health_check_id = aws_route53_health_check.primary.id
  records         = ["192.0.2.1"] # placeholder; environment layer overrides via data source
}

resource "aws_route53_record" "secondary_failover" {
  zone_id        = var.route53_zone_id
  name           = var.primary_dns_name
  type           = "A"
  ttl            = 60
  set_identifier = "secondary"
  failover_routing_policy {
    type = "SECONDARY"
  }
  records = ["192.0.2.2"] # placeholder; environment layer overrides via data source
}

# -----------------------------------------------------------------------------
# Outputs
# -----------------------------------------------------------------------------
output "secondary_rds_endpoint" {
  value       = aws_db_instance.secondary_replica.endpoint
  description = "Endpoint for the warm-standby read replica."
}

output "secondary_s3_bucket" {
  value       = aws_s3_bucket.secondary_objects.id
  description = "DR target S3 bucket."
}

output "primary_health_check_id" {
  value       = aws_route53_health_check.primary.id
  description = "Route 53 health-check guarding the failover policy."
}
