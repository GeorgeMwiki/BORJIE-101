# =============================================================================
# S3 Module - Outputs
# =============================================================================

output "bucket_id" {
  description = "The S3 bucket ID"
  value       = aws_s3_bucket.documents.id
}

output "bucket_arn" {
  description = "The S3 bucket ARN"
  value       = aws_s3_bucket.documents.arn
}

output "bucket_domain_name" {
  description = "The S3 bucket domain name"
  value       = aws_s3_bucket.documents.bucket_domain_name
}

output "bucket_regional_domain_name" {
  description = "The S3 bucket regional domain name"
  value       = aws_s3_bucket.documents.bucket_regional_domain_name
}

output "iam_policy_arn" {
  description = "IAM policy ARN for bucket access"
  value       = aws_iam_policy.s3_access.arn
}

output "kms_key_arn" {
  description = "KMS key ARN (if KMS encryption enabled)"
  value       = var.use_kms ? aws_kms_key.s3[0].arn : null
}
