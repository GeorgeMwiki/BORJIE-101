# =============================================================================
# ECR Module - Input Variables
# =============================================================================

variable "project_name" {
  description = "Project name for repository naming"
  type        = string
}

variable "environment" {
  description = "Environment (staging, production)"
  type        = string
}

variable "repository_names" {
  description = "List of repository names to create"
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

variable "image_tag_mutability" {
  description = "Image tag mutability setting"
  type        = string
  default     = "MUTABLE"
}

variable "scan_on_push" {
  description = "Scan images on push"
  type        = bool
  default     = true
}

variable "encryption_type" {
  description = "Encryption type (AES256 or KMS)"
  type        = string
  default     = "AES256"
}

variable "kms_key_arn" {
  description = "KMS key ARN for encryption (required if encryption_type is KMS)"
  type        = string
  default     = null
}

variable "keep_image_count" {
  description = "Number of tagged images to keep"
  type        = number
  default     = 30
}

variable "keep_untagged_count" {
  description = "Number of untagged images to keep"
  type        = number
  default     = 5
}

variable "staging_retention_days" {
  description = "Days to keep staging/develop images"
  type        = number
  default     = 14
}

variable "cross_account_ids" {
  description = "AWS account IDs for cross-account access"
  type        = list(string)
  default     = []
}
