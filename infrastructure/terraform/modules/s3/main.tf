# =============================================================================
# S3 Module - Document Storage for BORJIE
# =============================================================================
# Creates S3 bucket for storing documents, images, and reports
# Features: encryption, versioning, lifecycle rules, CORS for uploads
# =============================================================================

# -----------------------------------------------------------------------------
# S3 Bucket
# -----------------------------------------------------------------------------
resource "aws_s3_bucket" "documents" {
  bucket = "${var.project_name}-${var.environment}-documents"

  tags = {
    Name        = "${var.project_name}-${var.environment}-documents"
    Environment = var.environment
  }
}

# -----------------------------------------------------------------------------
# Bucket Versioning
# -----------------------------------------------------------------------------
resource "aws_s3_bucket_versioning" "documents" {
  bucket = aws_s3_bucket.documents.id
  versioning_configuration {
    status = var.enable_versioning ? "Enabled" : "Suspended"
  }
}

# -----------------------------------------------------------------------------
# Server-Side Encryption
# -----------------------------------------------------------------------------
resource "aws_s3_bucket_server_side_encryption_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = var.use_kms ? "aws:kms" : "AES256"
      kms_master_key_id = var.use_kms ? aws_kms_key.s3[0].arn : null
    }
    bucket_key_enabled = var.use_kms
  }
}

# -----------------------------------------------------------------------------
# KMS Key (optional)
# -----------------------------------------------------------------------------
resource "aws_kms_key" "s3" {
  count = var.use_kms ? 1 : 0

  description             = "KMS key for ${var.project_name} S3 encryption"
  deletion_window_in_days = 7
  enable_key_rotation     = true

  tags = {
    Name = "${var.project_name}-${var.environment}-s3-key"
  }
}

resource "aws_kms_alias" "s3" {
  count = var.use_kms ? 1 : 0

  name          = "alias/${var.project_name}-${var.environment}-s3"
  target_key_id = aws_kms_key.s3[0].key_id
}

# -----------------------------------------------------------------------------
# Public Access Block
# -----------------------------------------------------------------------------
resource "aws_s3_bucket_public_access_block" "documents" {
  bucket = aws_s3_bucket.documents.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# -----------------------------------------------------------------------------
# CORS Configuration (for direct uploads)
# -----------------------------------------------------------------------------
resource "aws_s3_bucket_cors_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET", "PUT", "POST"]
    allowed_origins = var.cors_allowed_origins
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}

# -----------------------------------------------------------------------------
# Lifecycle Rules
# -----------------------------------------------------------------------------
resource "aws_s3_bucket_lifecycle_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id

  # Move old versions to cheaper storage
  rule {
    id     = "archive-old-versions"
    status = var.enable_versioning ? "Enabled" : "Disabled"

    noncurrent_version_transition {
      noncurrent_days = 30
      storage_class   = "STANDARD_IA"
    }

    noncurrent_version_transition {
      noncurrent_days = 90
      storage_class   = "GLACIER"
    }

    noncurrent_version_expiration {
      noncurrent_days = 365
    }
  }

  # Delete incomplete multipart uploads
  rule {
    id     = "abort-incomplete-uploads"
    status = "Enabled"

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }

  # Transition temp files
  rule {
    id     = "temp-files-cleanup"
    status = "Enabled"

    filter {
      prefix = "temp/"
    }

    expiration {
      days = 7
    }
  }
}

# -----------------------------------------------------------------------------
# IAM Policy for Application Access
# -----------------------------------------------------------------------------
resource "aws_iam_policy" "s3_access" {
  name        = "${var.project_name}-${var.environment}-s3-access"
  description = "Policy for accessing ${var.project_name} documents bucket"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:ListBucket"
        ]
        Resource = [
          aws_s3_bucket.documents.arn,
          "${aws_s3_bucket.documents.arn}/*"
        ]
      }
    ]
  })
}
