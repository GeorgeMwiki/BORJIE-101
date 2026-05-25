# =============================================================================
# ECR Module - Container Registry for BORJIE
# =============================================================================
# Creates ECR repositories for all services
# Features: image scanning, lifecycle policies, cross-account access
# =============================================================================

# -----------------------------------------------------------------------------
# ECR Repositories
# -----------------------------------------------------------------------------
resource "aws_ecr_repository" "services" {
  for_each = toset(var.repository_names)

  name                 = "${var.project_name}/${each.value}"
  image_tag_mutability = var.image_tag_mutability

  image_scanning_configuration {
    scan_on_push = var.scan_on_push
  }

  encryption_configuration {
    encryption_type = var.encryption_type
    kms_key         = var.encryption_type == "KMS" ? var.kms_key_arn : null
  }

  tags = {
    Name        = "${var.project_name}-${each.value}"
    Environment = var.environment
    Service     = each.value
  }
}

# -----------------------------------------------------------------------------
# Lifecycle Policy (cleanup old images)
# -----------------------------------------------------------------------------
resource "aws_ecr_lifecycle_policy" "services" {
  for_each = aws_ecr_repository.services

  repository = each.value.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep last ${var.keep_image_count} tagged images"
        selection = {
          tagStatus     = "tagged"
          tagPrefixList = ["v", "release"]
          countType     = "imageCountMoreThan"
          countNumber   = var.keep_image_count
        }
        action = {
          type = "expire"
        }
      },
      {
        rulePriority = 2
        description  = "Keep last ${var.keep_untagged_count} untagged images"
        selection = {
          tagStatus   = "untagged"
          countType   = "imageCountMoreThan"
          countNumber = var.keep_untagged_count
        }
        action = {
          type = "expire"
        }
      },
      {
        rulePriority = 3
        description  = "Delete staging images older than ${var.staging_retention_days} days"
        selection = {
          tagStatus     = "tagged"
          tagPrefixList = ["staging", "develop"]
          countType     = "sinceImagePushed"
          countUnit     = "days"
          countNumber   = var.staging_retention_days
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}

# -----------------------------------------------------------------------------
# Repository Policy (optional cross-account access)
# -----------------------------------------------------------------------------
resource "aws_ecr_repository_policy" "cross_account" {
  for_each = var.cross_account_ids != [] ? aws_ecr_repository.services : {}

  repository = each.value.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "CrossAccountPull"
        Effect = "Allow"
        Principal = {
          AWS = [for id in var.cross_account_ids : "arn:aws:iam::${id}:root"]
        }
        Action = [
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
          "ecr:BatchCheckLayerAvailability"
        ]
      }
    ]
  })
}
