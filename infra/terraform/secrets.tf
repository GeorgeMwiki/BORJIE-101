# =============================================================================
# BORJIE — AWS Secrets Manager entries
# =============================================================================
# Secret *definitions* only — the actual values are populated out-of-band
# (via `aws secretsmanager put-secret-value` or a CI rotation lambda). This
# module is safe to `terraform apply` without any secret material present.
#
# Each resource exposes its ARN so other Terraform modules (scheduler.tf,
# ECS task definitions for api-gateway, webhooks, etc.) can reference it
# as `valueFrom` in container secrets blocks.
# =============================================================================

locals {
  secret_prefix = "${var.project_name}/${var.environment}"
}

# ----- Shared infra secrets -------------------------------------------------

resource "aws_secretsmanager_secret" "database_url" {
  name        = "${local.secret_prefix}/database-url"
  description = "Primary Postgres DATABASE_URL (with pgvector)."
}

resource "aws_secretsmanager_secret" "redis_url" {
  name        = "${local.secret_prefix}/redis-url"
  description = "ElastiCache Redis URL used for BullMQ + idempotency store + OTP TTL."
}

# ----- AI / OCR providers ---------------------------------------------------

resource "aws_secretsmanager_secret" "anthropic_api_key" {
  name        = "${local.secret_prefix}/anthropic-api-key"
  description = "Anthropic Claude API key (brain, doc-chat, notifications)."
}

resource "aws_secretsmanager_secret" "aws_textract_access_key" {
  name        = "${local.secret_prefix}/aws-textract-access-key"
  description = "IAM access key for the Textract-only OCR service role."
}

resource "aws_secretsmanager_secret" "aws_textract_secret_key" {
  name        = "${local.secret_prefix}/aws-textract-secret-key"
  description = "IAM secret key for the Textract-only OCR service role."
}

resource "aws_secretsmanager_secret" "google_vision_credentials" {
  name        = "${local.secret_prefix}/google-vision-credentials"
  description = "Google Vision service-account JSON (OCR fallback provider)."
}

# ----- GePG (Tanzania Government electronic Payment Gateway) ----------------

resource "aws_secretsmanager_secret" "gepg_signing_key" {
  name        = "${local.secret_prefix}/gepg-signing-key"
  description = "GePG HMAC signing key — rotated quarterly per GePG policy."
}

resource "aws_secretsmanager_secret" "gepg_sp_code" {
  name        = "${local.secret_prefix}/gepg-sp-code"
  description = "GePG assigned Service Provider code."
}

# ----- Outputs --------------------------------------------------------------

output "secret_arns" {
  description = "ARNs of all managed secrets — consumed by ECS task definitions."
  value = {
    database_url              = aws_secretsmanager_secret.database_url.arn
    redis_url                 = aws_secretsmanager_secret.redis_url.arn
    anthropic_api_key         = aws_secretsmanager_secret.anthropic_api_key.arn
    aws_textract_access_key   = aws_secretsmanager_secret.aws_textract_access_key.arn
    aws_textract_secret_key   = aws_secretsmanager_secret.aws_textract_secret_key.arn
    google_vision_credentials = aws_secretsmanager_secret.google_vision_credentials.arn
    gepg_signing_key          = aws_secretsmanager_secret.gepg_signing_key.arn
    gepg_sp_code              = aws_secretsmanager_secret.gepg_sp_code.arn
  }
}
